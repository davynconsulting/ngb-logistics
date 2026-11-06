-- 0024: container return terms and condition, incidents, credit approval, shipment closure and
--       reopening (FRS §5 steps 12-14, §8, §9 rule 8; AC-14, AC-15)
--
-- * Return deadline, depot and known charges are set through set_container_return_terms();
--   containers past their deadline become "return overdue" (hourly check + on change).
-- * Condition at return through record_container_condition(); damage opens an incident.
-- * Incidents (seal / cargo / container damage, shortage, discrepancy) have an append-only
--   comment log; only an operations manager or admin resolves them. Open incidents block closure.
-- * Closure needs: every container returned, POD for every container, no open incident,
--   no open exception, and invoices paid OR a recorded credit approval (finance/admin).
-- * close_shipment / reopen_shipment: operations manager or admin; reopen needs a reason;
--   both are kept in the append-only shipment_closure_log. The client is told when it closes.

-- ---------------------------------------------------------------------------
-- Containers: return terms and condition
-- ---------------------------------------------------------------------------
alter table public.containers
  add column return_charges_note    text check (length(return_charges_note) <= 500),
  add column condition_note         text check (length(condition_note) <= 1000),
  add column condition_recorded_at  timestamptz,
  add column condition_recorded_by  uuid references public.profiles (id),
  add constraint containers_condition_valid
    check (condition is null or condition in ('sound', 'needs_cleaning', 'minor_damage', 'damaged'));

-- only through the functions below, so the return status always follows
revoke update (condition, return_depot, return_deadline) on public.containers from authenticated;

-- delivered containers: awaiting return, or overdue once the deadline has passed
create or replace function private.refresh_return_status(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.containers c
     set return_status = case when c.return_deadline < now() then 'return_overdue' else 'awaiting_empty_return' end::public.return_status
   where c.shipment_id = p_shipment_id
     and c.operational_status = 'delivered'
     and c.return_status in ('awaiting_empty_return', 'return_overdue')
     and c.return_status is distinct from
         (case when c.return_deadline < now() then 'return_overdue' else 'awaiting_empty_return' end)::public.return_status;
  perform private.refresh_shipment_status(p_shipment_id);
end;
$$;

create or replace function private.return_check()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
  rec record;
begin
  for rec in
    select distinct c.shipment_id from public.containers c
     where c.operational_status = 'delivered' and c.return_status in ('awaiting_empty_return', 'return_overdue')
  loop
    perform private.refresh_return_status(rec.shipment_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.set_container_return_terms(
  p_container_ids    uuid[],
  p_return_deadline  timestamptz,
  p_return_depot     text default null,
  p_charges_note     text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shipment uuid;
begin
  if not coalesce(private.has_role('admin', 'ops_manager', 'transport_coord', 'doc_officer'), false) then
    raise exception 'You are not allowed to set container return terms' using errcode = '42501';
  end if;
  if p_container_ids is null or cardinality(p_container_ids) = 0 then
    raise exception 'Choose at least one container' using errcode = '22023';
  end if;
  select min(c.shipment_id::text)::uuid into v_shipment from public.containers c where c.id = any (p_container_ids);
  if v_shipment is null or not private.can_access_shipment(v_shipment)
     or (select count(*) from public.containers c where c.id = any (p_container_ids) and c.shipment_id = v_shipment)
        <> cardinality(p_container_ids) then
    raise exception 'Container not found' using errcode = 'P0002';
  end if;
  if (select s.overall_status from public.shipments s where s.id = v_shipment) = 'closed' then
    raise exception 'This shipment is closed' using errcode = '55000';
  end if;
  if exists (select 1 from public.containers c where c.id = any (p_container_ids) and c.operational_status = 'container_returned') then
    raise exception 'A returned container cannot get new return terms' using errcode = '55000';
  end if;
  if p_return_deadline is null or p_return_deadline < now() - interval '1 year' or p_return_deadline > now() + interval '1 year' then
    raise exception 'Enter the return deadline (within a year)' using errcode = '22023';
  end if;
  if length(trim(p_return_depot)) > 200 or length(trim(p_charges_note)) > 500 then
    raise exception 'A text field is too long' using errcode = '22023';
  end if;
  update public.containers c
     set return_deadline = p_return_deadline,
         return_depot = coalesce(nullif(trim(p_return_depot), ''), c.return_depot),
         return_charges_note = nullif(trim(p_charges_note), '')
   where c.id = any (p_container_ids);
  perform private.refresh_return_status(v_shipment);
end;
$$;

-- ---------------------------------------------------------------------------
-- Incidents (block closure until reviewed)
-- ---------------------------------------------------------------------------
create type public.incident_type as enum (
  'seal_damaged', 'cargo_damage', 'cargo_shortage', 'container_damage', 'delivery_discrepancy', 'other');
create type public.incident_status as enum ('open', 'resolved');

create table public.incidents (
  id                     uuid primary key default gen_random_uuid(),
  shipment_id            uuid not null references public.shipments (id) on delete restrict,
  container_id           uuid references public.containers (id) on delete restrict,
  incident_type          public.incident_type not null,
  description            text not null check (length(trim(description)) between 5 and 2000),
  evidence_document_ids  uuid[] not null default '{}',
  status                 public.incident_status not null default 'open',
  reported_by            uuid references public.profiles (id) default auth.uid(),
  reported_at            timestamptz not null default now(),
  resolution             text check (length(resolution) <= 2000),
  resolved_by            uuid references public.profiles (id),
  resolved_at            timestamptz,
  constraint incident_resolution check ((status = 'resolved') = (resolved_at is not null and resolution is not null))
);
create index incidents_shipment_idx on public.incidents (shipment_id) where status = 'open';

create table public.incident_notes (
  id           uuid primary key default gen_random_uuid(),
  incident_id  uuid not null references public.incidents (id) on delete restrict,
  note         text not null check (length(trim(note)) between 1 and 2000),
  created_by   uuid references public.profiles (id) default auth.uid(),
  created_at   timestamptz not null default now()
);
create index incident_notes_incident_idx on public.incident_notes (incident_id);

create trigger incidents_no_delete before delete on public.incidents
  for each row execute function private.prevent_mutation();
create trigger incident_notes_append_only before update or delete on public.incident_notes
  for each row execute function private.prevent_mutation();
create trigger audit_incidents after insert or update on public.incidents
  for each row execute function private.audit_row();
create trigger audit_incident_notes after insert on public.incident_notes
  for each row execute function private.audit_row();

-- a resolved incident stays resolved; only status/resolution fields ever change
create or replace function private.incident_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'resolved' then
    raise exception 'A resolved incident cannot change' using errcode = '55000';
  end if;
  if (new.shipment_id, new.container_id, new.incident_type, new.description, new.evidence_document_ids, new.reported_by, new.reported_at)
     is distinct from (old.shipment_id, old.container_id, old.incident_type, old.description, old.evidence_document_ids, old.reported_by, old.reported_at) then
    raise exception 'An incident report cannot be edited; add a comment instead' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger incidents_guard before update on public.incidents
  for each row execute function private.incident_guard();

insert into public.notification_rules (template_key, audience, push, whatsapp, description) values
  ('staff.incident_reported', 'staff',  true, false, 'Incident reported (shipment owner + operations managers)'),
  ('shipment.closed',         'client', true, true,  'Shipment closed: completion summary and booking contact');

insert into public.app_settings (key, value, description) values
  ('company.booking_contact', '"bookings@ngb-logistics.example · +250 788 000 100 (fictional)"',
   'Next-booking contact shown to clients when a shipment closes');

create or replace function private.ops_recipients(p_shipment_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct p.id), '{}') from public.profiles p
   where p.is_active and (p.role = 'ops_manager'
         or p.id = (select s.assigned_ops_user_id from public.shipments s where s.id = p_shipment_id))
     and p.role not in ('client', 'driver')
$$;

create or replace function private.open_incident(
  p_shipment_id uuid, p_container_id uuid, p_type public.incident_type, p_description text, p_evidence uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.incidents (shipment_id, container_id, incident_type, description, evidence_document_ids)
  values (p_shipment_id, p_container_id, p_type, trim(p_description), coalesce(p_evidence, '{}'))
  returning id into v_id;
  perform private.enqueue_notification('incident:' || v_id, 'staff.incident_reported', p_shipment_id,
    jsonb_build_object('shipment_id', p_shipment_id,
      'reference', (select s.shipment_reference from public.shipments s where s.id = p_shipment_id),
      'incident_type', p_type, 'description', left(trim(p_description), 300),
      'container', (select k.container_number from public.containers k where k.id = p_container_id)),
    private.ops_recipients(p_shipment_id));
  return v_id;
end;
$$;

create or replace function public.report_incident(
  p_shipment_id uuid, p_container_id uuid, p_type public.incident_type, p_description text, p_evidence uuid[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(private.has_role('admin', 'ops_manager', 'doc_officer', 'clearing_agent', 'transport_coord'), false)
     or not private.can_access_shipment(p_shipment_id) then
    raise exception 'You are not allowed to report incidents on this shipment' using errcode = '42501';
  end if;
  if (select s.overall_status from public.shipments s where s.id = p_shipment_id) = 'closed' then
    raise exception 'This shipment is closed; reopen it first' using errcode = '55000';
  end if;
  if p_type is null then
    raise exception 'Choose the type of incident' using errcode = '22023';
  end if;
  if p_description is null or length(trim(p_description)) not between 5 and 2000 then
    raise exception 'Describe what happened (5 to 2000 characters)' using errcode = '22023';
  end if;
  if p_container_id is not null and not exists
       (select 1 from public.containers c where c.id = p_container_id and c.shipment_id = p_shipment_id) then
    raise exception 'That container is not on this shipment' using errcode = '22023';
  end if;
  if cardinality(coalesce(p_evidence, '{}')) > 20 or exists (
       select 1 from unnest(coalesce(p_evidence, '{}')) e
        where not exists (select 1 from public.documents d where d.id = e and d.shipment_id = p_shipment_id)) then
    raise exception 'Evidence must be documents of this shipment' using errcode = '22023';
  end if;
  return private.open_incident(p_shipment_id, p_container_id, p_type, p_description, p_evidence);
end;
$$;

create or replace function public.add_incident_note(p_incident_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  i     public.incidents;
  v_id  uuid;
begin
  select * into i from public.incidents x where x.id = p_incident_id;
  if not found or not coalesce(private.has_role('admin', 'ops_manager', 'doc_officer', 'clearing_agent', 'transport_coord'), false)
     or not private.can_access_shipment(i.shipment_id) then
    raise exception 'Incident not found' using errcode = 'P0002';
  end if;
  if p_note is null or length(trim(p_note)) not between 1 and 2000 then
    raise exception 'Write the comment (up to 2000 characters)' using errcode = '22023';
  end if;
  insert into public.incident_notes (incident_id, note) values (i.id, trim(p_note)) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.resolve_incident(p_incident_id uuid, p_resolution text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.incidents;
begin
  if not coalesce(private.has_role('admin', 'ops_manager'), false) then
    raise exception 'Only an operations manager or admin can close an incident review' using errcode = '42501';
  end if;
  select * into i from public.incidents x where x.id = p_incident_id for update;
  if not found then
    raise exception 'Incident not found' using errcode = 'P0002';
  end if;
  if i.status = 'resolved' then
    raise exception 'This incident is already resolved' using errcode = '55000';
  end if;
  if p_resolution is null or length(trim(p_resolution)) not between 5 and 2000 then
    raise exception 'Write the outcome of the review (5 to 2000 characters)' using errcode = '22023';
  end if;
  update public.incidents x set status = 'resolved', resolution = trim(p_resolution), resolved_by = auth.uid(), resolved_at = now()
   where x.id = i.id;
end;
$$;

-- Condition at return (damage opens an incident automatically)
create or replace function public.record_container_condition(p_container_id uuid, p_condition text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c     public.containers;
  v_inc uuid;
begin
  if not coalesce(private.has_role('admin', 'ops_manager', 'transport_coord'), false) then
    raise exception 'You are not allowed to record container condition' using errcode = '42501';
  end if;
  select * into c from public.containers x where x.id = p_container_id for update;
  if not found or not private.can_access_shipment(c.shipment_id) then
    raise exception 'Container not found' using errcode = 'P0002';
  end if;
  if (select s.overall_status from public.shipments s where s.id = c.shipment_id) = 'closed' then
    raise exception 'This shipment is closed' using errcode = '55000';
  end if;
  if c.operational_status not in ('delivered', 'container_returned') then
    raise exception 'Record the condition once the container is delivered or returned' using errcode = '55000';
  end if;
  if p_condition is null or p_condition not in ('sound', 'needs_cleaning', 'minor_damage', 'damaged') then
    raise exception 'Choose the condition' using errcode = '22023';
  end if;
  if p_condition in ('minor_damage', 'damaged') and (p_note is null or length(trim(p_note)) < 5) then
    raise exception 'Describe the damage' using errcode = '22023';
  end if;
  if length(p_note) > 1000 then
    raise exception 'The note is too long' using errcode = '22023';
  end if;
  update public.containers x
     set condition = p_condition, condition_note = nullif(trim(p_note), ''),
         condition_recorded_at = now(), condition_recorded_by = auth.uid()
   where x.id = c.id;
  if p_condition in ('minor_damage', 'damaged') then
    v_inc := private.open_incident(c.shipment_id, c.id, 'container_damage',
      'Container ' || c.container_number || ' returned ' || replace(p_condition, '_', ' ') || ': ' || trim(p_note), '{}');
  end if;
  return v_inc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Credit approval (closure with an open balance, FRS §9 rule 8)
-- ---------------------------------------------------------------------------
create table public.closure_credit_approvals (
  id           uuid primary key default gen_random_uuid(),
  shipment_id  uuid not null references public.shipments (id) on delete restrict,
  reason       text not null check (length(trim(reason)) between 5 and 1000),
  approved_by  uuid references public.profiles (id) default auth.uid(),
  approved_at  timestamptz not null default now()
);
create index closure_credit_approvals_shipment_idx on public.closure_credit_approvals (shipment_id);
create trigger closure_credit_approvals_append_only before update or delete on public.closure_credit_approvals
  for each row execute function private.prevent_mutation();
create trigger audit_closure_credit_approvals after insert on public.closure_credit_approvals
  for each row execute function private.audit_row();

-- finance status: "credit approved" when an approval exists and it is not fully paid (a dispute stays visible)
create or replace function private.refresh_shipment_finance(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new public.finance_status;
begin
  select case
           when bool_or(i.status = 'disputed') then 'disputed'
           when count(*) > 0 and bool_and(i.status = 'paid') then 'paid'
           when exists (select 1 from public.closure_credit_approvals a where a.shipment_id = p_shipment_id) then 'credit_approved'
           when count(*) = 0 then 'not_invoiced'
           when bool_or(i.status = 'overdue') then 'overdue'
           when bool_or(i.status in ('partially_paid', 'paid')) then 'partially_paid'
           else 'invoiced'
         end::public.finance_status
    into v_new
    from public.invoices i
   where i.shipment_id = p_shipment_id and i.status not in ('draft', 'void');
  update public.shipments s set finance_status = v_new
   where s.id = p_shipment_id and s.finance_status is distinct from v_new;
end;
$$;

create or replace function public.approve_closure_credit(p_shipment_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if private.current_app_role() not in ('finance', 'admin') or private.current_app_role() is null then
    raise exception 'Only finance or an admin can approve credit for closure' using errcode = '42501';
  end if;
  if not exists (select 1 from public.shipments s where s.id = p_shipment_id) then
    raise exception 'Shipment not found' using errcode = 'P0002';
  end if;
  if (select s.overall_status from public.shipments s where s.id = p_shipment_id) = 'closed' then
    raise exception 'This shipment is already closed' using errcode = '55000';
  end if;
  if (select s.finance_status from public.shipments s where s.id = p_shipment_id) = 'paid' then
    raise exception 'Everything is paid; no credit approval is needed' using errcode = '55000';
  end if;
  if p_reason is null or length(trim(p_reason)) not between 5 and 1000 then
    raise exception 'Give the reason and terms of the credit (5 to 1000 characters)' using errcode = '22023';
  end if;
  insert into public.closure_credit_approvals (shipment_id, reason) values (p_shipment_id, trim(p_reason)) returning id into v_id;
  perform private.refresh_shipment_finance(p_shipment_id);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Closure
-- ---------------------------------------------------------------------------
alter table public.shipments
  add column closed_by     uuid references public.profiles (id),
  add column closure_note  text check (length(closure_note) <= 1000);

create table public.shipment_closure_log (
  id           uuid primary key default gen_random_uuid(),
  shipment_id  uuid not null references public.shipments (id) on delete restrict,
  action       text not null check (action in ('closed', 'reopened')),
  note         text check (length(note) <= 1000),
  checks       jsonb,
  actor_id     uuid references public.profiles (id) default auth.uid(),
  occurred_at  timestamptz not null default now(),
  constraint reopen_has_reason check (action = 'closed' or length(trim(note)) >= 5)
);
create index shipment_closure_log_shipment_idx on public.shipment_closure_log (shipment_id);
create trigger shipment_closure_log_append_only before update or delete on public.shipment_closure_log
  for each row execute function private.prevent_mutation();

-- The checklist (also shown in the UI). Office staff who can see the shipment only.
create or replace function public.closure_checks(p_shipment_id uuid)
returns table (check_key text, label text, ok boolean, detail text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s        public.shipments;
  v_total  integer;
  v_back   integer;
  v_pod    integer;
  v_inc    integer;
  v_credit text;
begin
  if not coalesce(private.is_office_staff(), false) or not private.can_access_shipment(p_shipment_id) then
    return;
  end if;
  select * into s from public.shipments x where x.id = p_shipment_id;
  if not found then return; end if;
  select count(*), count(*) filter (where c.operational_status = 'container_returned'),
         count(*) filter (where c.delivery_status = 'pod_received')
    into v_total, v_back, v_pod from public.containers c where c.shipment_id = p_shipment_id;
  select count(*) into v_inc from public.incidents i where i.shipment_id = p_shipment_id and i.status = 'open';
  select a.reason || ' (' || coalesce(p.full_name, 'finance') || ')' into v_credit
    from public.closure_credit_approvals a left join public.profiles p on p.id = a.approved_by
   where a.shipment_id = p_shipment_id order by a.approved_at desc limit 1;

  return query values
    ('pod', 'Proof of delivery for every container', v_total > 0 and v_pod = v_total,
       format('%s of %s received', v_pod, v_total)),
    ('returned', 'Every empty container returned', v_total > 0 and v_back = v_total,
       format('%s of %s returned', v_back, v_total)),
    ('incidents', 'No open incidents', v_inc = 0,
       case when v_inc = 0 then 'None open' else format('%s open', v_inc) end),
    ('exceptions', 'No open exceptions', not s.has_open_exception,
       case when s.has_open_exception then 'Resolve the open exceptions' else 'None open' end),
    ('finance', 'Invoices paid, or credit approved', s.finance_status in ('paid', 'credit_approved'),
       case when s.finance_status = 'paid' then 'Paid'
            when s.finance_status = 'credit_approved' then 'Credit approved: ' || coalesce(v_credit, '')
            else 'Finance status: ' || replace(s.finance_status::text, '_', ' ') end);
end;
$$;

create or replace function public.close_shipment(p_shipment_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s          public.shipments;
  v_missing  text;
  v_checks   jsonb;
begin
  if not coalesce(private.has_role('admin', 'ops_manager'), false) then
    raise exception 'Only an operations manager or admin can close a shipment' using errcode = '42501';
  end if;
  select * into s from public.shipments x where x.id = p_shipment_id for update;
  if not found then
    raise exception 'Shipment not found' using errcode = 'P0002';
  end if;
  if s.overall_status = 'closed' then
    raise exception 'This shipment is already closed' using errcode = '55000';
  end if;
  if s.overall_status = 'draft' then
    raise exception 'A draft shipment cannot be closed' using errcode = '55000';
  end if;
  if length(p_note) > 1000 then
    raise exception 'The note is too long' using errcode = '22023';
  end if;
  select string_agg(c.label || ' (' || c.detail || ')', '; ' order by c.check_key) filter (where not c.ok),
         jsonb_agg(jsonb_build_object('check', c.check_key, 'ok', c.ok, 'detail', c.detail))
    into v_missing, v_checks
    from public.closure_checks(p_shipment_id) c;
  if v_checks is null then
    raise exception 'Shipment not found' using errcode = 'P0002';
  end if;
  if v_missing is not null then
    raise exception 'Cannot close yet: %', v_missing using errcode = '55000';
  end if;
  update public.shipments x
     set overall_status = 'closed', closed_at = now(), closed_by = auth.uid(), closure_note = nullif(trim(p_note), '')
   where x.id = s.id;
  insert into public.shipment_closure_log (shipment_id, action, note, checks)
  values (s.id, 'closed', nullif(trim(p_note), ''), v_checks);

  perform private.enqueue_notification('shipment:' || s.id || ':closed:' || floor(extract(epoch from now()))::bigint,
    'shipment.closed', s.id,
    jsonb_strip_nulls(private.shipment_payload(s.id) || jsonb_build_object(
      'containers', (select count(*) from public.containers c where c.shipment_id = s.id),
      'delivered_at', (select max(c.delivery_at) from public.containers c where c.shipment_id = s.id),
      'booking_contact', (select a.value #>> '{}' from public.app_settings a where a.key = 'company.booking_contact'))),
    private.client_recipients(s.id));
end;
$$;

create or replace function public.reopen_shipment(p_shipment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments;
begin
  if not coalesce(private.has_role('admin', 'ops_manager'), false) then
    raise exception 'Only an operations manager or admin can reopen a shipment' using errcode = '42501';
  end if;
  select * into s from public.shipments x where x.id = p_shipment_id for update;
  if not found then
    raise exception 'Shipment not found' using errcode = 'P0002';
  end if;
  if s.overall_status <> 'closed' then
    raise exception 'This shipment is not closed' using errcode = '55000';
  end if;
  if p_reason is null or length(trim(p_reason)) not between 5 and 1000 then
    raise exception 'Give the reason for reopening (5 to 1000 characters)' using errcode = '22023';
  end if;
  -- leave "closed"; the derived status is recomputed from the containers
  update public.shipments x
     set overall_status = 'operationally_complete', closed_at = null, closed_by = null, closure_note = null
   where x.id = s.id;
  perform private.refresh_shipment_status(s.id);
  insert into public.shipment_closure_log (shipment_id, action, note) values (s.id, 'reopened', trim(p_reason));
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS and privileges
-- ---------------------------------------------------------------------------
alter table public.incidents                enable row level security;
alter table public.incident_notes           enable row level security;
alter table public.closure_credit_approvals enable row level security;
alter table public.shipment_closure_log     enable row level security;
revoke all on public.incidents, public.incident_notes, public.closure_credit_approvals, public.shipment_closure_log
  from anon, authenticated;
grant select on public.incidents, public.incident_notes, public.closure_credit_approvals, public.shipment_closure_log
  to authenticated;

create policy incidents_select on public.incidents for select to authenticated
  using ((select private.is_office_staff()) and (select private.can_access_shipment(shipment_id)));
create policy incident_notes_select on public.incident_notes for select to authenticated
  using (exists (select 1 from public.incidents i where i.id = incident_id));   -- inherits incidents RLS
create policy closure_credit_approvals_select on public.closure_credit_approvals for select to authenticated
  using ((select private.is_office_staff()) and (select private.can_access_shipment(shipment_id)));
create policy shipment_closure_log_select on public.shipment_closure_log for select to authenticated
  using ((select private.is_office_staff()) and (select private.can_access_shipment(shipment_id)));

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.set_container_return_terms(uuid[], timestamptz, text, text)',
    'public.report_incident(uuid, uuid, public.incident_type, text, uuid[])',
    'public.add_incident_note(uuid, text)', 'public.resolve_incident(uuid, text)',
    'public.record_container_condition(uuid, text, text)', 'public.approve_closure_credit(uuid, text)',
    'public.closure_checks(uuid)', 'public.close_shipment(uuid, text)', 'public.reopen_shipment(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'private.refresh_return_status(uuid)', 'private.return_check()', 'private.incident_guard()',
    'private.ops_recipients(uuid)',
    'private.open_incident(uuid, uuid, public.incident_type, text, uuid[])'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;

-- Hourly: containers past their return deadline → return overdue. Skipped without pg_cron (tests).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('ngb-return-check', '15 * * * *', 'select private.return_check()');
  end if;
end;
$$;
