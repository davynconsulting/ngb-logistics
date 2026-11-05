-- ============================================================================
-- 0013 · Exceptions, SLA rules and the overdue-milestone scan
-- FRS §4 (exception is not a status), §8 (exception handling), §12, AC-10
--   • An exception is a separate record; the shipment keeps its last status
--     and shipments.has_open_exception is maintained by a trigger.
--   • Staff open, follow up, escalate and resolve exceptions through functions.
--     Every change is logged in the append-only exception_updates.
--   • private.sla_scan() (pg_cron, every 15 minutes) opens an exception when a
--     container exceeds its configured threshold, escalates unresolved ones to
--     the operations manager, and clears system exceptions whose condition no
--     longer applies. It never changes an operational status by itself
--     ("do not label as delayed without confirmation", FRS §8), except marking
--     an empty return as overdue after its deadline.
--   • Clients have no access to exceptions yet: their view (client message
--     only, never internal details) comes with the portal in Sprint 3.
-- ============================================================================

create type public.exception_type as enum (
  'document_missing', 'vessel_delay', 'port_sla_breach', 'dispatch_risk', 'customs_hold',
  'transit_update_missing', 'transit_overdue', 'delivery_discrepancy', 'return_overdue', 'other'
);
create type public.exception_severity as enum ('low', 'medium', 'high', 'critical');
create type public.exception_status as enum ('open', 'resolved');
create type public.sla_stage as enum ('documents', 'port_processing', 'dispatch', 'transit_update', 'transit', 'empty_return');
create type public.exception_update_kind as enum ('opened', 'note', 'follow_up', 'owner', 'severity', 'escalated', 'resolved');

-- ---------------------------------------------------------------------------
-- sla_rules: thresholds per stage; a route- or port-specific rule wins over the default
-- ---------------------------------------------------------------------------
create table public.sla_rules (
  id                    uuid primary key default gen_random_uuid(),
  stage                 public.sla_stage not null,
  port_id               uuid references public.ports (id),
  route_id              uuid references public.routes (id),
  threshold_hours       integer not null check (threshold_hours between 0 and 2160),
  escalate_after_hours  integer not null default 24 check (escalate_after_hours between 1 and 720),
  severity              public.exception_severity not null default 'medium',
  is_active             boolean not null default true,
  description           text,
  created_at            timestamptz not null default now()
);
create unique index sla_rules_scope_unique
  on public.sla_rules (stage, coalesce(port_id, '00000000-0000-0000-0000-000000000000'::uuid),
                       coalesce(route_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Defaults agreed for Sprint 2 (FRS §12 decision table)
insert into public.sla_rules (stage, threshold_hours, escalate_after_hours, severity, description) values
  ('documents', 0, 48, 'medium', 'Required document still missing/rejected after its due date'),
  ('port_processing', 96, 24, 'high', 'Discharged container not ready for dispatch within 96 h (FRS: 3-4 days)'),
  ('dispatch', 24, 24, 'medium', 'Ready for dispatch but not gated out within 24 h'),
  ('transit_update', 48, 12, 'medium', 'No milestone from a container in transit for 48 h (route checkpoint setting applies when set)'),
  ('transit', 24, 12, 'high', 'In transit longer than the route estimate + 24 h'),
  ('empty_return', 0, 24, 'medium', 'Empty container not returned by its deadline');

create or replace function private.sla_rule(p_stage public.sla_stage, p_port_id uuid, p_route_id uuid)
returns public.sla_rules
language sql
stable
security definer
set search_path = ''
as $$
  select r.* from public.sla_rules r
   where r.stage = p_stage and r.is_active
     and (r.route_id is null or r.route_id = p_route_id)
     and (r.port_id is null or r.port_id = p_port_id)
   order by (r.route_id is not null) desc, (r.port_id is not null) desc
   limit 1
$$;

-- ---------------------------------------------------------------------------
-- exceptions
-- ---------------------------------------------------------------------------
create table public.exceptions (
  id                 uuid primary key default gen_random_uuid(),
  shipment_id        uuid not null references public.shipments (id) on delete restrict,
  container_id       uuid references public.containers (id) on delete restrict,
  exception_type     public.exception_type not null,
  severity           public.exception_severity not null default 'medium',
  status             public.exception_status not null default 'open',
  title              text not null check (length(title) between 3 and 200),
  details            text check (length(details) <= 2000),           -- internal
  client_message     text check (length(client_message) <= 500),     -- what the client may see (Sprint 3)
  client_visible     boolean not null default false,
  owner_id           uuid references public.profiles (id),
  source             public.event_source not null default 'staff',
  sla_rule_id        uuid references public.sla_rules (id),
  sla_stage          public.sla_stage,
  dedup_key          text,
  last_event_id      uuid references public.milestone_events (id),
  next_action        text check (length(next_action) <= 500),
  next_follow_up_at  timestamptz,
  opened_at          timestamptz not null default now(),
  opened_by          uuid references public.profiles (id) default auth.uid(),
  escalated_at       timestamptz,
  resolved_at        timestamptz,
  resolved_by        uuid references public.profiles (id),
  resolution         text check (length(resolution) <= 1000),
  updated_at         timestamptz not null default now(),
  constraint resolved_has_resolution check (status = 'open' or (resolution is not null and resolved_at is not null))
);
create index exceptions_open_idx on public.exceptions (status, escalated_at, next_follow_up_at) where status = 'open';
create index exceptions_shipment_idx on public.exceptions (shipment_id);
create index exceptions_owner_idx on public.exceptions (owner_id) where status = 'open';
-- the scan opens at most one exception per condition at a time
create unique index exceptions_open_dedup on public.exceptions (dedup_key) where status = 'open' and dedup_key is not null;

create table public.exception_updates (
  id            uuid primary key default gen_random_uuid(),
  exception_id  uuid not null references public.exceptions (id) on delete restrict,
  kind          public.exception_update_kind not null,
  note          text check (length(note) <= 2000),
  data          jsonb,
  created_by    uuid references public.profiles (id) default auth.uid(),
  created_at    timestamptz not null default now()
);
create index exception_updates_exception_idx on public.exception_updates (exception_id, created_at);

create trigger exception_updates_append_only
  before update or delete on public.exception_updates
  for each row execute function private.prevent_mutation();
create trigger audit_exceptions after insert or update or delete on public.exceptions
  for each row execute function private.audit_row();
create trigger audit_sla_rules after insert or update or delete on public.sla_rules
  for each row execute function private.audit_row();

-- shipments.has_open_exception follows the exceptions table
create or replace function private.refresh_open_exception_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.shipments s
     set has_open_exception = exists (select 1 from public.exceptions x where x.shipment_id = s.id and x.status = 'open')
   where s.id = new.shipment_id;
  return null;
end;
$$;

create trigger exceptions_open_flag
  after insert or update of status on public.exceptions
  for each row execute function private.refresh_open_exception_flag();

-- default owner: the shipment's responsible staff member, else the caller
create or replace function private.valid_owner(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p
                  where p.id = p_user_id and p.is_active
                    and p.role in ('admin', 'ops_manager', 'doc_officer', 'clearing_agent', 'transport_coord', 'finance'))
$$;

-- ---------------------------------------------------------------------------
-- Staff functions (SECURITY DEFINER; the checks at the top are the boundary)
-- ---------------------------------------------------------------------------
create or replace function private.exception_for_staff(p_exception_id uuid)
returns public.exceptions
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  x public.exceptions;
begin
  if not coalesce(private.is_staff(), false) or private.current_app_role() = 'driver' then
    raise exception 'You are not allowed to manage exceptions' using errcode = '42501';
  end if;
  select * into x from public.exceptions e where e.id = p_exception_id;
  if not found or not private.can_access_shipment(x.shipment_id) then
    raise exception 'Exception not found' using errcode = 'P0002';
  end if;
  return x;
end;
$$;

create or replace function public.open_exception(
  p_shipment_id        uuid,
  p_type               public.exception_type,
  p_title              text,
  p_severity           public.exception_severity default 'medium',
  p_details            text default null,
  p_container_id       uuid default null,
  p_owner_id           uuid default null,
  p_next_action        text default null,
  p_next_follow_up_at  timestamptz default null,
  p_client_message     text default null,
  p_client_visible     boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role   public.app_role := private.current_app_role();
  v_title  text := nullif(trim(p_title), '');
  v_owner  uuid;
  v_id     uuid;
begin
  if v_role is null or v_role not in ('admin', 'ops_manager', 'doc_officer', 'clearing_agent', 'transport_coord', 'finance') then
    raise exception 'You are not allowed to open exceptions' using errcode = '42501';
  end if;
  if not private.can_access_shipment(p_shipment_id) then
    raise exception 'Shipment not found' using errcode = 'P0002';
  end if;
  if v_title is null or length(v_title) < 3 or length(v_title) > 200 then
    raise exception 'Enter a short title (3 to 200 characters)' using errcode = '22023';
  end if;
  if p_container_id is not null and not exists (
       select 1 from public.containers c where c.id = p_container_id and c.shipment_id = p_shipment_id) then
    raise exception 'The container is not on this shipment' using errcode = '22023';
  end if;
  v_owner := coalesce(p_owner_id,
                      (select s.assigned_ops_user_id from public.shipments s where s.id = p_shipment_id
                         and private.valid_owner(s.assigned_ops_user_id)),
                      auth.uid());
  if not private.valid_owner(v_owner) then
    raise exception 'The owner must be an active NGB staff member' using errcode = '22023';
  end if;
  if p_next_follow_up_at is not null and p_next_follow_up_at > now() + interval '90 days' then
    raise exception 'The follow-up date is too far ahead' using errcode = '22023';
  end if;
  if length(p_details) > 2000 or length(p_next_action) > 500 or length(p_client_message) > 500 then
    raise exception 'A text field is too long' using errcode = '22023';
  end if;

  insert into public.exceptions (shipment_id, container_id, exception_type, severity, title, details, owner_id,
                                 next_action, next_follow_up_at, client_message, client_visible, source,
                                 last_event_id)
  values (p_shipment_id, p_container_id, p_type, coalesce(p_severity, 'medium'), v_title, nullif(trim(p_details), ''),
          v_owner, nullif(trim(p_next_action), ''), p_next_follow_up_at, nullif(trim(p_client_message), ''),
          coalesce(p_client_visible, false) and nullif(trim(p_client_message), '') is not null,
          case when v_role = 'driver' then 'driver' else 'staff' end::public.event_source,
          (select e.id from public.milestone_events e
            where e.shipment_id = p_shipment_id and e.correction_of_event_id is null and not private.is_voided(e.id)
              and (p_container_id is null or e.container_id is null or e.container_id = p_container_id)
            order by e.event_at desc limit 1))
  returning id into v_id;

  insert into public.exception_updates (exception_id, kind, note, data)
  values (v_id, 'opened', nullif(trim(p_details), ''), jsonb_build_object('owner_id', v_owner, 'severity', coalesce(p_severity, 'medium')));
  return v_id;
end;
$$;

-- Follow-up: add a note and/or change next action, follow-up date, owner or severity.
-- Owner and severity changes: the owner or an operations manager/admin.
create or replace function public.update_exception(
  p_exception_id       uuid,
  p_note               text default null,
  p_next_action        text default null,
  p_next_follow_up_at  timestamptz default null,
  p_owner_id           uuid default null,
  p_severity           public.exception_severity default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  x        public.exceptions := private.exception_for_staff(p_exception_id);
  v_role   public.app_role := private.current_app_role();
  v_note   text := nullif(trim(p_note), '');
  v_action text := nullif(trim(p_next_action), '');
  v_lead   boolean := v_role in ('admin', 'ops_manager') or x.owner_id = auth.uid();
begin
  perform 1 from public.exceptions e where e.id = x.id for update;
  if x.status <> 'open' then
    raise exception 'This exception is resolved' using errcode = '55000';
  end if;
  if v_note is null and v_action is null and p_next_follow_up_at is null and p_owner_id is null and p_severity is null then
    raise exception 'Nothing to update' using errcode = '22023';
  end if;
  if (p_owner_id is not null and p_owner_id is distinct from x.owner_id or p_severity is not null and p_severity <> x.severity)
     and not v_lead then
    raise exception 'Only the owner or an operations manager can reassign or change severity' using errcode = '42501';
  end if;
  if p_owner_id is not null and not private.valid_owner(p_owner_id) then
    raise exception 'The owner must be an active NGB staff member' using errcode = '22023';
  end if;
  if p_next_follow_up_at is not null and (p_next_follow_up_at < now() - interval '1 hour' or p_next_follow_up_at > now() + interval '90 days') then
    raise exception 'The follow-up date is not valid' using errcode = '22023';
  end if;
  if length(v_note) > 2000 or length(v_action) > 500 then
    raise exception 'A text field is too long' using errcode = '22023';
  end if;

  update public.exceptions e set
    next_action       = coalesce(v_action, e.next_action),
    next_follow_up_at = coalesce(p_next_follow_up_at, e.next_follow_up_at),
    owner_id          = coalesce(p_owner_id, e.owner_id),
    severity          = coalesce(p_severity, e.severity),
    updated_at        = now()
  where e.id = x.id;

  if v_note is not null then
    insert into public.exception_updates (exception_id, kind, note) values (x.id, 'note', v_note);
  end if;
  if v_action is not null or p_next_follow_up_at is not null then
    insert into public.exception_updates (exception_id, kind, data)
    values (x.id, 'follow_up', jsonb_strip_nulls(jsonb_build_object('next_action', v_action, 'next_follow_up_at', p_next_follow_up_at)));
  end if;
  if p_owner_id is not null and p_owner_id is distinct from x.owner_id then
    insert into public.exception_updates (exception_id, kind, data)
    values (x.id, 'owner', jsonb_build_object('from', x.owner_id, 'to', p_owner_id));
  end if;
  if p_severity is not null and p_severity <> x.severity then
    insert into public.exception_updates (exception_id, kind, data)
    values (x.id, 'severity', jsonb_build_object('from', x.severity, 'to', p_severity));
  end if;
end;
$$;

-- Raise to the operations manager queue (any staff member with access)
create or replace function public.escalate_exception(p_exception_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  x       public.exceptions := private.exception_for_staff(p_exception_id);
  v_note  text := nullif(trim(p_note), '');
begin
  perform 1 from public.exceptions e where e.id = x.id for update;
  if x.status <> 'open' then
    raise exception 'This exception is resolved' using errcode = '55000';
  end if;
  if x.escalated_at is not null then
    raise exception 'This exception is already escalated' using errcode = '55000';
  end if;
  if v_note is null or length(v_note) < 3 or length(v_note) > 2000 then
    raise exception 'Say why it needs the operations manager' using errcode = '22023';
  end if;
  update public.exceptions e set escalated_at = now(), updated_at = now() where e.id = x.id;
  insert into public.exception_updates (exception_id, kind, note) values (x.id, 'escalated', v_note);
end;
$$;

-- Resolve: the owner or an operations manager/admin, with a resolution note
create or replace function public.resolve_exception(p_exception_id uuid, p_resolution text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  x      public.exceptions := private.exception_for_staff(p_exception_id);
  v_role public.app_role := private.current_app_role();
  v_res  text := nullif(trim(p_resolution), '');
begin
  perform 1 from public.exceptions e where e.id = x.id for update;
  if x.status <> 'open' then
    raise exception 'This exception is already resolved' using errcode = '55000';
  end if;
  if not (v_role in ('admin', 'ops_manager') or x.owner_id = auth.uid()) then
    raise exception 'Only the owner or an operations manager can resolve this' using errcode = '42501';
  end if;
  if v_res is null or length(v_res) < 3 or length(v_res) > 1000 then
    raise exception 'Describe how it was resolved' using errcode = '22023';
  end if;
  update public.exceptions e
     set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolution = v_res, updated_at = now()
   where e.id = x.id;
  insert into public.exception_updates (exception_id, kind, note) values (x.id, 'resolved', v_res);
end;
$$;

-- ---------------------------------------------------------------------------
-- The SLA scan (runs as the job owner; no user context)
-- ---------------------------------------------------------------------------
create or replace function private.sla_candidates()
returns table (dedup_key text, shipment_id uuid, container_id uuid, stage public.sla_stage, rule_id uuid,
               severity public.exception_severity, exception_type public.exception_type, title text, since timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with live_events as (
    select e.* from public.milestone_events e
     where e.correction_of_event_id is null and not private.is_voided(e.id)
  ),
  last_event as (
    select distinct on (e.container_id) e.container_id, e.event_at
      from live_events e where e.container_id is not null
     order by e.container_id, e.event_at desc
  ),
  ready as (
    select distinct on (e.container_id) e.container_id, e.event_at
      from live_events e where e.container_id is not null and e.milestone_type = 'ready_for_dispatch'
     order by e.container_id, e.event_at desc
  ),
  c as (
    select k.*, s.origin_port_id, s.overall_status as ship_status,
           (select a.route_id from public.transport_assignments a
              join public.transport_assignment_containers ac on ac.assignment_id = a.id
             where ac.container_id = k.id and a.status = 'active' order by a.assigned_at desc limit 1) as route_id
      from public.containers k join public.shipments s on s.id = k.shipment_id
     where s.overall_status not in ('draft', 'closed')
  )
  -- port processing: discharged but not ready for dispatch
  select 'port_processing:' || c.id, c.shipment_id, c.id, 'port_processing'::public.sla_stage, r.id, r.severity,
         'port_sla_breach'::public.exception_type, 'Port processing over ' || r.threshold_hours || ' h', c.discharge_at
    from c cross join lateral private.sla_rule('port_processing', c.origin_port_id, c.route_id) r
   where c.operational_status in ('container_discharged', 'port_processing')
     and c.discharge_at + make_interval(hours => r.threshold_hours) < now()
  union all
  -- dispatch: ready for dispatch but not gated out
  select 'dispatch:' || c.id, c.shipment_id, c.id, 'dispatch', r.id, r.severity,
         'dispatch_risk', 'Not gated out ' || r.threshold_hours || ' h after ready for dispatch', rd.event_at
    from c join ready rd on rd.container_id = c.id
    cross join lateral private.sla_rule('dispatch', c.origin_port_id, c.route_id) r
   where c.operational_status in ('ready_for_dispatch', 'truck_assigned', 'loading', 'loaded')
     and rd.event_at + make_interval(hours => r.threshold_hours) < now()
  union all
  -- transit update missing: no milestone while in transit
  select 'transit_update:' || c.id, c.shipment_id, c.id, 'transit_update', r.id, r.severity,
         'transit_update_missing', 'No transit update for '
           || coalesce(rt.checkpoint_alert_hours, r.threshold_hours) || ' h', greatest(le.event_at, c.gate_out_at)
    from c left join last_event le on le.container_id = c.id
    left join public.routes rt on rt.id = c.route_id
    cross join lateral private.sla_rule('transit_update', c.origin_port_id, c.route_id) r
   where c.operational_status = 'in_transit'
     and greatest(le.event_at, c.gate_out_at)
         + make_interval(hours => coalesce(rt.checkpoint_alert_hours, r.threshold_hours)) < now()
  union all
  -- transit overdue: longer than route estimate + grace
  select 'transit:' || c.id, c.shipment_id, c.id, 'transit', r.id, r.severity,
         'transit_overdue', 'In transit beyond the ' || coalesce(rt.transit_estimate_hours, 72) || ' h route estimate', c.gate_out_at
    from c left join public.routes rt on rt.id = c.route_id
    cross join lateral private.sla_rule('transit', c.origin_port_id, c.route_id) r
   where c.operational_status = 'in_transit' and c.gate_out_at is not null
     and c.gate_out_at + make_interval(hours => coalesce(rt.transit_estimate_hours, 72) + r.threshold_hours) < now()
  union all
  -- empty container not returned by its deadline
  select 'empty_return:' || c.id, c.shipment_id, c.id, 'empty_return', r.id, r.severity,
         'return_overdue', 'Empty container not returned by ' || to_char(c.return_deadline at time zone 'UTC', 'DD Mon YYYY'), c.return_deadline::timestamptz
    from c cross join lateral private.sla_rule('empty_return', c.origin_port_id, c.route_id) r
   where c.operational_status = 'delivered' and c.return_deadline is not null
     and c.return_deadline::timestamptz + make_interval(hours => r.threshold_hours) < now()
  union all
  -- required documents missing/rejected after the due date (one per shipment)
  select 'documents:' || s.id, s.id, null::uuid, 'documents', r.id, r.severity,
         'document_missing', count(*) || ' required document(s) overdue', min(dr.due_date)::timestamptz
    from public.shipments s
    join public.document_requirements dr on dr.shipment_id = s.id
    cross join lateral private.sla_rule('documents', s.origin_port_id, null) r
   where s.overall_status not in ('draft', 'closed', 'operationally_complete')
     and dr.is_required and dr.status in ('missing', 'rejected') and dr.due_date is not null
     and dr.due_date::timestamptz + make_interval(hours => r.threshold_hours) < now()
   group by s.id, r.id, r.severity
$$;

create or replace function private.sla_scan()
returns table (opened integer, escalated integer, cleared integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opened integer := 0;
  v_escalated integer := 0;
  v_cleared integer := 0;
  v_ship uuid;
begin
  create temp table if not exists pg_temp.sla_now on commit drop as select * from private.sla_candidates() with no data;
  truncate pg_temp.sla_now;
  insert into pg_temp.sla_now select * from private.sla_candidates();

  -- 1. open one exception per new condition
  with ins as (
    insert into public.exceptions (shipment_id, container_id, exception_type, severity, title, details, owner_id,
                                   source, sla_rule_id, sla_stage, dedup_key, opened_by, next_action, last_event_id)
    select n.shipment_id, n.container_id, n.exception_type, n.severity, n.title,
           'Opened automatically: over the configured threshold since ' || to_char(n.since at time zone 'UTC', 'DD Mon YYYY HH24:MI') || ' UTC',
           (select s.assigned_ops_user_id from public.shipments s where s.id = n.shipment_id
              and private.valid_owner(s.assigned_ops_user_id)),
           'system', n.rule_id, n.stage, n.dedup_key, null,
           case n.stage when 'transit_update' then 'Request an update from the driver/transporter'
                        when 'port_processing' then 'Check the outstanding port/customs tasks'
                        when 'dispatch' then 'Confirm truck and loading plan'
                        when 'transit' then 'Confirm position and revise the ETA if needed'
                        when 'empty_return' then 'Arrange the empty return; check charges'
                        else 'Request the missing documents from the client' end,
           (select e.id from public.milestone_events e
             where e.shipment_id = n.shipment_id and e.correction_of_event_id is null and not private.is_voided(e.id)
               and (n.container_id is null or e.container_id is null or e.container_id = n.container_id)
             order by e.event_at desc limit 1)
      from pg_temp.sla_now n
     where not exists (select 1 from public.exceptions x where x.dedup_key = n.dedup_key and x.status = 'open')
    on conflict (dedup_key) where status = 'open' and dedup_key is not null do nothing
    returning id
  ), log as (
    insert into public.exception_updates (exception_id, kind, note, created_by)
    select id, 'opened', 'Opened by the SLA check', null from ins returning 1
  )
  select count(*) into v_opened from log;

  -- empty return past its deadline: mark the container's return as overdue
  for v_ship in
    update public.containers k set return_status = 'return_overdue'
      from pg_temp.sla_now n
     where n.stage = 'empty_return' and n.container_id = k.id and k.return_status = 'awaiting_empty_return'
    returning k.shipment_id
  loop
    perform private.refresh_shipment_status(v_ship);
  end loop;

  -- 2. clear system exceptions whose condition no longer applies
  with res as (
    update public.exceptions x
       set status = 'resolved', resolved_at = now(), resolved_by = null, updated_at = now(),
           resolution = 'Cleared automatically: the milestone was recorded or the condition no longer applies'
     where x.status = 'open' and x.source = 'system' and x.dedup_key is not null
       and not exists (select 1 from pg_temp.sla_now n where n.dedup_key = x.dedup_key)
    returning x.id, x.resolution
  ), log as (
    insert into public.exception_updates (exception_id, kind, note, created_by)
    select id, 'resolved', resolution, null from res returning 1
  )
  select count(*) into v_cleared from log;

  -- 3. escalate unresolved exceptions to the operations manager queue
  with esc as (
    update public.exceptions x set escalated_at = now(), updated_at = now()
     where x.status = 'open' and x.escalated_at is null
       and x.opened_at + make_interval(hours => coalesce(
             (select r.escalate_after_hours from public.sla_rules r where r.id = x.sla_rule_id), 24)) < now()
    returning x.id
  ), log as (
    insert into public.exception_updates (exception_id, kind, note, created_by)
    select id, 'escalated', 'Escalated automatically: unresolved past the escalation time', null from esc returning 1
  )
  select count(*) into v_escalated from log;

  return query select v_opened, v_escalated, v_cleared;
end;
$$;

-- Manual "check now" for operations managers and admins
create or replace function public.run_sla_scan()
returns table (opened integer, escalated integer, cleared integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(private.has_role('admin', 'ops_manager'), false) then
    raise exception 'Only an operations manager or admin can run the SLA check' using errcode = '42501';
  end if;
  return query select * from private.sla_scan();
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and RLS (no direct writes; clients have no access yet)
-- ---------------------------------------------------------------------------
alter table public.sla_rules         enable row level security;
alter table public.exceptions        enable row level security;
alter table public.exception_updates enable row level security;

revoke all on public.sla_rules, public.exceptions, public.exception_updates from anon, authenticated;
grant select on public.sla_rules, public.exceptions, public.exception_updates to authenticated;
grant insert (stage, port_id, route_id, threshold_hours, escalate_after_hours, severity, is_active, description)
  on public.sla_rules to authenticated;
grant update (threshold_hours, escalate_after_hours, severity, is_active, description) on public.sla_rules to authenticated;

create policy sla_rules_select on public.sla_rules for select to authenticated using ((select private.is_staff()));
create policy sla_rules_insert on public.sla_rules for insert to authenticated
  with check ((select private.has_role('admin', 'ops_manager')));
create policy sla_rules_update on public.sla_rules for update to authenticated
  using ((select private.has_role('admin', 'ops_manager'))) with check ((select private.has_role('admin', 'ops_manager')));

create policy exceptions_select on public.exceptions for select to authenticated
  using ((select private.is_staff()) and (select private.current_app_role()) <> 'driver'
         and (select private.can_access_shipment(shipment_id)));
create policy exception_updates_select on public.exception_updates for select to authenticated
  using (exists (select 1 from public.exceptions x where x.id = exception_id));  -- inherits exceptions RLS

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.open_exception(uuid, public.exception_type, text, public.exception_severity, text, uuid, uuid, text, timestamptz, text, boolean)',
    'public.update_exception(uuid, text, text, timestamptz, uuid, public.exception_severity)',
    'public.escalate_exception(uuid, text)',
    'public.resolve_exception(uuid, text)',
    'public.run_sla_scan()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'private.sla_rule(public.sla_stage, uuid, uuid)', 'private.sla_candidates()', 'private.sla_scan()',
    'private.refresh_open_exception_flag()', 'private.valid_owner(uuid)', 'private.exception_for_staff(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Schedule the scan every 15 minutes (Supabase pg_cron). Skipped where pg_cron
-- is not available (the local test database).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('ngb-sla-scan', '*/15 * * * *', 'select private.sla_scan()');
  end if;
end;
$$;
