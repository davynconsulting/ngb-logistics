-- ============================================================================
-- 0010 · Status engine: milestone events, transition rules, corrections
-- FRS §3 (workflow steps 03-12), §4 (status model + transition controls),
-- §6.4 (milestone event fields), AC-02, AC-03, AC-04
--
-- Principles
--   • milestone_events is the append-only source of truth. Status columns on
--     shipments and containers change ONLY through record_milestone() and
--     correct_milestone(), in the same transaction as the event.
--   • Which milestone may follow which status, and which roles may record it,
--     is data (milestone_catalogue), so the rules can be reviewed and tested.
--   • Each container has its own operational status (AC-02). The shipment's
--     overall status is the least-advanced container (agreed in the plan).
--   • Out-of-order events need an operations manager/admin override with a
--     reason. Moving a status backwards is never a milestone: it is a
--     correction (void), which keeps the original in the history (AC-03).
-- ============================================================================

create type public.milestone_type as enum (
  -- shipment level
  'shipment_confirmed',
  'vessel_arrived',
  -- container level, port side
  'container_discharged',
  'port_processing_started',
  'ready_for_dispatch',
  'truck_assigned',
  'loading_started',
  'loaded',
  'gate_out',
  -- road transit
  'transit_checkpoint',
  'arrived_at_border',
  'border_crossed',
  'arrived',
  -- delivery and container return (independent tracks, FRS §3 rule)
  'offloading_started',
  'delivered',
  'pod_received',
  'empty_returned',
  -- customs track (shipment level)
  'customs_entry_prepared',
  'customs_submitted',
  'customs_inspection',
  'customs_duties_pending',
  'customs_released',
  'customs_on_hold',
  -- free-form update without a status change
  'update'
);

create type public.event_source as enum ('staff', 'driver', 'integration', 'system');
create type public.notification_state as enum ('pending', 'sent', 'failed', 'suppressed');

-- Containers get their own transport track (in transit / at border / arrived)
alter table public.containers
  add column transport_status public.transport_status not null default 'unassigned';

-- ---------------------------------------------------------------------------
-- milestone_catalogue: the transition rules, as data.
--   requires_*  current status(es) that must hold before the milestone
--               (for shipment-wide milestones: on every container)
--   sets_*      status the milestone moves a track to
-- ---------------------------------------------------------------------------
create table public.milestone_catalogue (
  milestone_type          public.milestone_type primary key,
  label                   text not null,
  scope                   text not null check (scope in ('shipment', 'container', 'either')),
  requires_overall        public.shipment_status[],
  requires_operational    public.shipment_status[],
  requires_customs        public.customs_status[],
  sets_overall            public.shipment_status,
  sets_operational        public.shipment_status,
  sets_customs            public.customs_status,
  sets_transport          public.transport_status,
  sets_delivery           public.delivery_status,
  sets_return             public.return_status,
  allowed_roles           public.app_role[] not null,
  client_visible_default  boolean not null default true,
  requires_location       boolean not null default false,
  sort_order              integer not null unique
);

comment on table public.milestone_catalogue is
  'Allowed milestones: preconditions, effects and roles. Changed only by migration.';

insert into public.milestone_catalogue
  (milestone_type, label, scope, requires_overall, requires_operational, requires_customs,
   sets_overall, sets_operational, sets_customs, sets_transport, sets_delivery, sets_return,
   allowed_roles, client_visible_default, requires_location, sort_order)
values
  ('shipment_confirmed', 'Shipment confirmed', 'shipment', '{draft}', null, null,
   'registered', null, null, null, null, null,
   '{admin,ops_manager,doc_officer}', true, false, 10),
  ('vessel_arrived', 'Vessel arrived', 'shipment', null, '{registered}', null,
   null, 'vessel_arrived', null, null, null, null,
   '{admin,ops_manager,clearing_agent}', true, true, 20),
  ('container_discharged', 'Container discharged', 'container', null, '{vessel_arrived}', null,
   null, 'container_discharged', null, null, null, null,
   '{admin,ops_manager,clearing_agent}', true, true, 30),
  ('port_processing_started', 'Port processing started', 'container', null, '{container_discharged}', null,
   null, 'port_processing', null, null, null, null,
   '{admin,ops_manager,clearing_agent}', true, false, 40),
  ('ready_for_dispatch', 'Ready for dispatch', 'container', null, '{port_processing}', null,
   null, 'ready_for_dispatch', null, null, null, null,
   '{admin,ops_manager,clearing_agent}', true, false, 50),
  ('truck_assigned', 'Truck assigned', 'container', null, '{ready_for_dispatch}', null,
   null, 'truck_assigned', null, 'assigned', null, null,
   '{admin,ops_manager,transport_coord}', true, false, 60),
  ('loading_started', 'Loading started', 'container', null, '{truck_assigned}', null,
   null, 'loading', null, 'awaiting_loading', null, null,
   '{admin,ops_manager,transport_coord}', true, false, 70),
  ('loaded', 'Loaded', 'container', null, '{truck_assigned,loading}', null,
   null, 'loaded', null, 'loaded', null, null,
   '{admin,ops_manager,transport_coord}', true, false, 80),
  ('gate_out', 'Gate-out (left port/ICD)', 'container', null, '{loaded}', null,
   null, 'in_transit', null, 'in_transit', null, null,
   '{admin,ops_manager,transport_coord}', true, true, 90),
  ('transit_checkpoint', 'Transit checkpoint', 'container', null, '{in_transit}', null,
   null, null, null, null, null, null,
   '{admin,ops_manager,transport_coord,driver}', true, true, 100),
  ('arrived_at_border', 'Arrived at border', 'container', null, '{in_transit}', null,
   null, null, null, 'at_border', null, null,
   '{admin,ops_manager,transport_coord,driver}', true, true, 110),
  ('border_crossed', 'Border crossed', 'container', null, '{in_transit}', null,
   null, null, null, 'in_transit', null, null,
   '{admin,ops_manager,transport_coord,driver}', true, true, 120),
  ('arrived', 'Arrived at destination', 'container', null, '{in_transit}', null,
   null, 'arrived', null, 'arrived', null, null,
   '{admin,ops_manager,transport_coord,driver}', true, false, 130),
  ('offloading_started', 'Offloading started', 'container', null, '{arrived}', null,
   null, null, null, null, 'offloading', null,
   '{admin,ops_manager,transport_coord,driver}', true, false, 140),
  ('delivered', 'Delivered', 'container', null, '{arrived}', null,
   null, 'delivered', null, null, 'pod_pending', 'awaiting_empty_return',
   '{admin,ops_manager,transport_coord,driver}', true, false, 150),
  ('pod_received', 'Proof of delivery received', 'container', null, '{delivered,container_returned}', null,
   null, null, null, null, 'pod_received', null,
   '{admin,ops_manager,transport_coord,doc_officer}', true, false, 160),
  ('empty_returned', 'Empty container returned', 'container', null, '{delivered}', null,
   null, 'container_returned', null, null, null, 'returned',
   '{admin,ops_manager,transport_coord}', true, true, 170),
  ('customs_entry_prepared', 'Customs entry in preparation', 'shipment', null, null, '{not_started,on_hold}',
   null, null, 'entry_in_preparation', null, null, null,
   '{admin,ops_manager,clearing_agent}', true, false, 200),
  ('customs_submitted', 'Customs declaration submitted', 'shipment', null, null, '{entry_in_preparation,on_hold}',
   null, null, 'submitted', null, null, null,
   '{admin,ops_manager,clearing_agent}', true, false, 210),
  ('customs_inspection', 'Customs inspection', 'shipment', null, null, '{submitted,on_hold}',
   null, null, 'inspection', null, null, null,
   '{admin,ops_manager,clearing_agent}', true, false, 220),
  ('customs_duties_pending', 'Duties and taxes pending', 'shipment', null, null, '{submitted,inspection,on_hold}',
   null, null, 'duties_pending', null, null, null,
   '{admin,ops_manager,clearing_agent}', true, false, 230),
  ('customs_released', 'Customs released', 'shipment', null, null, '{submitted,inspection,duties_pending}',
   null, null, 'released', null, null, null,
   '{admin,ops_manager,clearing_agent}', true, false, 240),
  ('customs_on_hold', 'Customs on hold', 'shipment', null, null, '{entry_in_preparation,submitted,inspection,duties_pending}',
   null, null, 'on_hold', null, null, null,
   '{admin,ops_manager,clearing_agent}', true, false, 250),
  ('update', 'Status update', 'either', null, null, null,
   null, null, null, null, null, null,
   '{admin,ops_manager,doc_officer,clearing_agent,transport_coord,driver}', false, false, 900);

-- ---------------------------------------------------------------------------
-- milestone_events: append-only (FRS §6.4)
--   One row per container for container milestones; container_id is null for
--   shipment-wide milestones. Rows recorded together share batch_id.
--   previous_state: snapshot of the fields the event changed, so a void can
--   restore them exactly. Corrections are new rows (correction_of_event_id).
-- ---------------------------------------------------------------------------
create table public.milestone_events (
  id                      uuid primary key default gen_random_uuid(),
  shipment_id             uuid not null references public.shipments (id) on delete restrict,
  container_id            uuid references public.containers (id) on delete restrict,
  batch_id                uuid not null,
  milestone_type          public.milestone_type not null,
  status_track            text,
  previous_status         text,
  new_status              text,
  event_at                timestamptz not null,
  recorded_at             timestamptz not null default now(),
  recorded_by             uuid references public.profiles (id),
  source                  public.event_source not null default 'staff',
  location                text check (length(location) <= 200),
  public_note             text check (length(public_note) <= 2000),
  seal_number             text check (length(seal_number) <= 50),
  evidence_document_ids   uuid[] not null default '{}',
  is_override             boolean not null default false,
  override_reason         text check (length(override_reason) <= 500),
  client_visible          boolean not null default true,
  notification_state      public.notification_state not null default 'pending',
  idempotency_key         text check (length(idempotency_key) <= 100),
  previous_state          jsonb,
  -- corrections
  correction_of_event_id  uuid references public.milestone_events (id),
  correction_reason       text check (length(correction_reason) <= 500),
  is_void                 boolean not null default false,

  constraint override_has_reason check (not is_override or override_reason is not null),
  constraint correction_has_reason check (correction_of_event_id is null or correction_reason is not null),
  constraint void_is_correction check (not is_void or correction_of_event_id is not null)
);

create index milestone_events_shipment_idx on public.milestone_events (shipment_id, recorded_at desc);
create index milestone_events_container_idx on public.milestone_events (container_id) where container_id is not null;
create index milestone_events_correction_idx on public.milestone_events (correction_of_event_id) where correction_of_event_id is not null;
create index milestone_events_batch_idx on public.milestone_events (batch_id);
create unique index milestone_events_idempotency
  on public.milestone_events (idempotency_key, coalesce(container_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where idempotency_key is not null;

-- Append-only, except that the notification worker (Sprint 3) may update
-- notification_state. Nothing else can ever change; nothing can be deleted.
create or replace function private.milestone_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     or (to_jsonb(old) - 'notification_state') is distinct from (to_jsonb(new) - 'notification_state') then
    raise exception 'milestone_events is append-only: % is not allowed', tg_op
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger milestone_events_append_only
  before update or delete on public.milestone_events
  for each row execute function private.milestone_events_append_only();

-- Internal notes: staff only (clients have no policy on this table)
create table public.milestone_internal_notes (
  id           uuid primary key default gen_random_uuid(),
  shipment_id  uuid not null references public.shipments (id) on delete restrict,
  batch_id     uuid not null,
  note         text not null check (length(note) between 1 and 2000),
  created_by   uuid references public.profiles (id) default auth.uid(),
  created_at   timestamptz not null default now()
);
create index milestone_internal_notes_batch_idx on public.milestone_internal_notes (batch_id);

create trigger milestone_internal_notes_append_only
  before update or delete on public.milestone_internal_notes
  for each row execute function private.prevent_mutation();

create trigger audit_milestone_catalogue after insert or update or delete on public.milestone_catalogue
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- Derived shipment statuses
--   overall   = least-advanced container (draft/closed are kept as they are);
--               every container returned → operationally complete;
--               registered + required documents missing/rejected → awaiting documents
--   transport / delivery = least-advanced container
--   return    = overdue or dispute if any container is, else least advanced
-- ---------------------------------------------------------------------------
create or replace function private.refresh_shipment_status(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s           record;
  v_n         integer;
  v_min_op    public.shipment_status;
  v_all_back  boolean;
  v_overall   public.shipment_status;
  v_transport public.transport_status;
  v_delivery  public.delivery_status;
  v_return    public.return_status;
begin
  select sh.overall_status, sh.doc_status, sh.transport_status, sh.delivery_status, sh.return_status
    into s from public.shipments sh where sh.id = p_shipment_id;
  if not found then return; end if;

  select count(*), min(c.operational_status), bool_and(c.operational_status = 'container_returned'),
         min(c.transport_status) filter (where c.transport_status <> 'delayed'),
         min(c.delivery_status),
         coalesce(max(c.return_status) filter (where c.return_status in ('return_overdue', 'dispute')),
                  min(c.return_status))
    into v_n, v_min_op, v_all_back, v_transport, v_delivery, v_return
    from public.containers c where c.shipment_id = p_shipment_id;

  if v_n = 0 then return; end if;

  if s.overall_status in ('draft', 'closed') then
    v_overall := s.overall_status;
  elsif v_all_back then
    v_overall := 'operationally_complete';
  elsif v_min_op = 'registered' and s.doc_status in ('missing', 'rejected') then
    v_overall := 'awaiting_documents';
  else
    v_overall := v_min_op;
  end if;

  update public.shipments
     set overall_status   = v_overall,
         transport_status = coalesce(v_transport, transport_status),
         delivery_status  = v_delivery,
         return_status    = v_return
   where id = p_shipment_id
     and (overall_status, transport_status, delivery_status, return_status)
         is distinct from (v_overall, coalesce(v_transport, transport_status), v_delivery, v_return);
end;
$$;

-- Document status changes can move a registered shipment into/out of "awaiting documents"
create or replace function private.on_shipment_doc_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.refresh_shipment_status(new.id);
  return null;
end;
$$;

create trigger shipments_doc_status_refresh
  after update of doc_status on public.shipments
  for each row
  when (new.doc_status is distinct from old.doc_status)
  execute function private.on_shipment_doc_status_change();

-- Snapshot of the fields a milestone may change (used to restore on void)
create or replace function private.shipment_snapshot(p_shipment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'overall_status', s.overall_status, 'customs_status', s.customs_status,
    'actual_vessel_arrival', s.actual_vessel_arrival)
  from public.shipments s where s.id = p_shipment_id
$$;

create or replace function private.container_snapshot(p_container_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'operational_status', c.operational_status, 'transport_status', c.transport_status,
    'delivery_status', c.delivery_status, 'return_status', c.return_status,
    'location_kind', c.location_kind, 'location_name', c.location_name,
    'seal_number', c.seal_number, 'return_depot', c.return_depot,
    'discharge_at', c.discharge_at, 'gate_out_at', c.gate_out_at,
    'delivery_at', c.delivery_at, 'empty_return_at', c.empty_return_at)
  from public.containers c where c.id = p_container_id
$$;

create or replace function private.is_voided(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.milestone_events v
                 where v.correction_of_event_id = p_event_id and v.is_void)
$$;

-- Apply a milestone's effects to one container (caller has validated everything)
create or replace function private.apply_container_milestone(
  p_container_id uuid,
  c public.milestone_catalogue,
  p_event_at timestamptz,
  p_location text,
  p_location_kind public.location_kind,
  p_seal text,
  p_pod_evidence boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.containers k set
    operational_status = coalesce(c.sets_operational, k.operational_status),
    transport_status   = coalesce(c.sets_transport, k.transport_status),
    delivery_status    = case
                           when c.milestone_type = 'delivered' and p_pod_evidence then 'pod_received'
                           else coalesce(c.sets_delivery, k.delivery_status) end,
    return_status      = coalesce(c.sets_return, k.return_status),
    discharge_at       = case when c.milestone_type = 'container_discharged' then p_event_at else k.discharge_at end,
    gate_out_at        = case when c.milestone_type = 'gate_out' then p_event_at else k.gate_out_at end,
    delivery_at        = case when c.milestone_type = 'delivered' then p_event_at else k.delivery_at end,
    empty_return_at    = case when c.milestone_type = 'empty_returned' then p_event_at else k.empty_return_at end,
    return_depot       = case when c.milestone_type = 'empty_returned' then coalesce(p_location, k.return_depot) else k.return_depot end,
    seal_number        = case when p_seal is not null and c.milestone_type in ('loaded', 'gate_out') then p_seal else k.seal_number end,
    location_kind      = case c.milestone_type
                           when 'container_discharged' then coalesce(p_location_kind, k.location_kind, 'terminal')
                           when 'gate_out' then 'in_transit'
                           when 'transit_checkpoint' then 'in_transit'
                           when 'arrived_at_border' then 'in_transit'
                           when 'border_crossed' then 'in_transit'
                           when 'arrived' then 'destination'
                           when 'empty_returned' then 'depot'
                           else coalesce(p_location_kind, k.location_kind) end,
    location_name      = case when p_location is not null and c.milestone_type <> 'update' then p_location else k.location_name end
  where k.id = p_container_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_milestone: validate and record a milestone, update statuses, all in
-- one transaction.
--
-- SECURITY DEFINER because users cannot write status columns. The checks at
-- the top ARE the security boundary: active staff role, role allowed for this
-- milestone, access to the shipment (agents/drivers: assigned only), valid
-- transition or an authorised override with a reason.
-- ---------------------------------------------------------------------------
create or replace function public.record_milestone(
  p_shipment_id            uuid,
  p_milestone              public.milestone_type,
  p_event_at               timestamptz,
  p_container_ids          uuid[] default null,
  p_location               text default null,
  p_location_kind          public.location_kind default null,
  p_public_note            text default null,
  p_internal_note          text default null,
  p_client_visible         boolean default null,
  p_evidence_document_ids  uuid[] default null,
  p_seal_number            text default null,
  p_override_reason        text default null,
  p_idempotency_key        text default null
)
returns table (event_id uuid, container_id uuid, new_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role       public.app_role := private.current_app_role();
  c            public.milestone_catalogue;
  s            public.shipments;
  v_targets    uuid[];
  v_problems   text[] := '{}';
  v_override   boolean := false;
  v_reason     text := nullif(trim(p_override_reason), '');
  v_location   text := nullif(trim(p_location), '');
  v_pnote      text := nullif(trim(p_public_note), '');
  v_inote      text := nullif(trim(p_internal_note), '');
  v_seal       text := nullif(upper(trim(p_seal_number)), '');
  v_evidence   uuid[] := coalesce(p_evidence_document_ids, '{}');
  v_pod        boolean := false;
  v_visible    boolean;
  v_batch      uuid := gen_random_uuid();
  v_source     public.event_source;
  v_snapshot   jsonb;
  v_id         uuid;
  v_cid        uuid;
  k            record;
  v_track      text;
  v_prev       text;
  v_new        text;
begin
  -- 1. Who is calling
  if v_role is null or v_role = 'client' then
    raise exception 'You are not allowed to record milestones' using errcode = '42501';
  end if;
  select * into c from public.milestone_catalogue m where m.milestone_type = p_milestone;
  if not found then
    raise exception 'Unknown milestone' using errcode = '22023';
  end if;
  if not v_role = any (c.allowed_roles) then
    raise exception 'Your role cannot record "%"', c.label using errcode = '42501';
  end if;
  if not private.can_access_shipment(p_shipment_id) then
    raise exception 'Shipment not found' using errcode = 'P0002';
  end if;
  v_source := case when v_role = 'driver' then 'driver' else 'staff' end;

  -- 2. Lock the shipment so concurrent milestones are applied one at a time
  select * into s from public.shipments sh where sh.id = p_shipment_id for update;
  if not found then
    raise exception 'Shipment not found' using errcode = 'P0002';
  end if;

  -- 3. Replayed request (double tap, retry on a weak connection): return what was recorded
  if p_idempotency_key is not null and exists (
       select 1 from public.milestone_events e where e.idempotency_key = p_idempotency_key) then
    if exists (select 1 from public.milestone_events e
               where e.idempotency_key = p_idempotency_key and e.shipment_id <> p_shipment_id) then
      raise exception 'Duplicate request key' using errcode = '22023';
    end if;
    return query
      select e.id, e.container_id, e.new_status from public.milestone_events e
       where e.idempotency_key = p_idempotency_key order by e.recorded_at, e.id;
    return;
  end if;

  -- 4. Input checks
  if s.overall_status = 'closed' then
    raise exception 'This shipment is closed' using errcode = '55000';
  end if;
  if s.overall_status = 'draft' and p_milestone not in ('shipment_confirmed', 'update') then
    raise exception 'Confirm the shipment before recording milestones' using errcode = '55000';
  end if;
  if p_event_at is null or p_event_at > now() + interval '10 minutes' then
    raise exception 'The event time cannot be in the future' using errcode = '22023';
  end if;
  if p_event_at < now() - interval '1 year' then
    raise exception 'The event time is more than a year ago' using errcode = '22023';
  end if;
  if c.requires_location and v_location is null then
    raise exception 'Enter the location for "%"', c.label using errcode = '22023';
  end if;
  if length(v_location) > 200 or length(v_pnote) > 2000 or length(v_inote) > 2000
     or length(v_seal) > 50 or length(v_reason) > 500 then
    raise exception 'A text field is too long' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_evidence) x
             where not exists (select 1 from public.documents d
                               where d.id = x and d.shipment_id = p_shipment_id)) then
    raise exception 'Evidence must be documents of this shipment' using errcode = '22023';
  end if;
  v_pod := exists (select 1 from public.documents d
                   where d.id = any (v_evidence) and d.document_type = 'proof_of_delivery');

  -- 5. Which containers
  if c.scope = 'shipment' then
    select array_agg(k2.id order by k2.container_number) into v_targets
      from public.containers k2 where k2.shipment_id = p_shipment_id;
  elsif c.scope = 'container' or (c.scope = 'either' and cardinality(coalesce(p_container_ids, '{}')) > 0) then
    select array_agg(distinct x) into v_targets from unnest(coalesce(p_container_ids, '{}')) x;
    if v_targets is null then
      raise exception 'Choose at least one container' using errcode = '22023';
    end if;
    if (select count(*) from public.containers k2
         where k2.id = any (v_targets) and k2.shipment_id = p_shipment_id) <> cardinality(v_targets) then
      raise exception 'A container is not on this shipment' using errcode = '22023';
    end if;
  else
    v_targets := '{}';
  end if;

  -- 6. Transition rules
  if c.requires_overall is not null and not s.overall_status = any (c.requires_overall) then
    v_problems := v_problems || format('shipment is %s', s.overall_status);
  end if;
  if c.requires_customs is not null and not s.customs_status = any (c.requires_customs) then
    v_problems := v_problems || format('customs is %s', s.customs_status);
  end if;
  if c.requires_operational is not null then
    for k in select k2.container_number, k2.operational_status from public.containers k2
              where k2.id = any (v_targets) order by k2.container_number loop
      if not k.operational_status = any (c.requires_operational) then
        v_problems := v_problems || format('%s is %s', k.container_number, k.operational_status);
      end if;
    end loop;
  end if;
  -- Gate-out only after customs release (FRS §4.2 transition controls)
  if p_milestone = 'gate_out' and s.customs_status <> 'released' then
    v_problems := v_problems || 'customs is not released'::text;
  end if;
  -- Never move a container backwards with a milestone (that is a correction)
  if c.sets_operational is not null then
    for k in select k2.container_number, k2.operational_status from public.containers k2
              where k2.id = any (v_targets) order by k2.container_number loop
      if k.operational_status >= c.sets_operational then
        raise exception 'Container % is already %: use a correction to change past milestones',
          k.container_number, k.operational_status using errcode = '55000';
      end if;
    end loop;
  end if;

  if cardinality(v_problems) > 0 then
    if v_reason is null then
      raise exception 'Not allowed now (%): an operations manager can override with a reason',
        array_to_string(v_problems, '; ') using errcode = '55000';
    end if;
    if v_role not in ('admin', 'ops_manager') then
      raise exception 'Only an operations manager or admin can override the workflow' using errcode = '42501';
    end if;
    v_override := true;
  else
    v_reason := null;  -- nothing to override
  end if;

  v_visible := coalesce(p_client_visible, c.client_visible_default);

  -- 7. Apply and record
  if c.scope = 'shipment' or cardinality(v_targets) = 0 then
    -- one shipment-level event (shipment-wide milestones also move every container)
    v_snapshot := case
      when c.sets_overall is null and c.sets_customs is null and c.sets_operational is null
           and p_milestone <> 'vessel_arrived' then null
      else jsonb_build_object('shipment', private.shipment_snapshot(p_shipment_id),
             'containers', coalesce((select jsonb_object_agg(x::text, private.container_snapshot(x))
                                     from unnest(v_targets) x), '{}'::jsonb))
    end;

    v_track := case when c.sets_overall is not null then 'overall'
                    when c.sets_customs is not null then 'customs'
                    when c.sets_operational is not null then 'operational' end;
    v_prev := case v_track when 'overall' then s.overall_status::text
                           when 'customs' then s.customs_status::text
                           when 'operational' then (select min(k2.operational_status)::text from public.containers k2
                                                    where k2.id = any (v_targets)) end;
    v_new := coalesce(c.sets_overall::text, c.sets_customs::text, c.sets_operational::text);

    update public.shipments sh set
      overall_status        = coalesce(c.sets_overall, sh.overall_status),
      customs_status        = coalesce(c.sets_customs, sh.customs_status),
      actual_vessel_arrival = case when p_milestone = 'vessel_arrived' then p_event_at else sh.actual_vessel_arrival end
    where sh.id = p_shipment_id;

    if c.sets_operational is not null then
      foreach v_cid in array v_targets loop
        perform private.apply_container_milestone(v_cid, c, p_event_at, v_location, p_location_kind, v_seal, v_pod);
      end loop;
    end if;

    insert into public.milestone_events (
      shipment_id, container_id, batch_id, milestone_type, status_track, previous_status, new_status,
      event_at, recorded_by, source, location, public_note, seal_number, evidence_document_ids,
      is_override, override_reason, client_visible, notification_state, idempotency_key, previous_state)
    values (
      p_shipment_id, null, v_batch, p_milestone, v_track, v_prev, v_new,
      p_event_at, auth.uid(), v_source, v_location, v_pnote, v_seal, v_evidence,
      v_override, v_reason, v_visible, case when v_visible then 'pending' else 'suppressed' end::public.notification_state,
      p_idempotency_key, v_snapshot)
    returning id into v_id;
  else
    -- one event per container (AC-02)
    v_track := case when c.sets_operational is not null then 'operational'
                    when c.sets_transport is not null then 'transport'
                    when c.sets_delivery is not null then 'delivery'
                    when c.sets_return is not null then 'return' end;
    foreach v_cid in array v_targets loop
      select * into k from public.containers k2 where k2.id = v_cid;
      -- checkpoints change the location only; keep a snapshot so a void restores it
      v_snapshot := case when p_milestone = 'update' then null
                         else jsonb_build_object('containers', jsonb_build_object(v_cid::text, private.container_snapshot(v_cid))) end;
      v_prev := case v_track when 'operational' then k.operational_status::text
                             when 'transport' then k.transport_status::text
                             when 'delivery' then k.delivery_status::text
                             when 'return' then k.return_status::text end;
      v_new := case v_track when 'operational' then c.sets_operational::text
                            when 'transport' then c.sets_transport::text
                            when 'delivery' then c.sets_delivery::text
                            when 'return' then c.sets_return::text end;

      perform private.apply_container_milestone(v_cid, c, p_event_at, v_location, p_location_kind, v_seal, v_pod);

      insert into public.milestone_events (
        shipment_id, container_id, batch_id, milestone_type, status_track, previous_status, new_status,
        event_at, recorded_by, source, location, public_note, seal_number, evidence_document_ids,
        is_override, override_reason, client_visible, notification_state, idempotency_key, previous_state)
      values (
        p_shipment_id, v_cid, v_batch, p_milestone, v_track, v_prev, v_new,
        p_event_at, auth.uid(), v_source, v_location, v_pnote, v_seal, v_evidence,
        v_override, v_reason, v_visible, case when v_visible then 'pending' else 'suppressed' end::public.notification_state,
        p_idempotency_key, v_snapshot);
    end loop;
  end if;

  if v_inote is not null then
    insert into public.milestone_internal_notes (shipment_id, batch_id, note)
    values (p_shipment_id, v_batch, v_inote);
  end if;

  perform private.refresh_shipment_status(p_shipment_id);

  return query
    select e.id, e.container_id, e.new_status from public.milestone_events e
     where e.batch_id = v_batch order by e.recorded_at, e.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- correct_milestone: append a correction (AC-03). The original is never changed.
--   p_void = false  corrects time / location / public note
--   p_void = true   cancels the event; its status changes are reverted, which
--                   is only allowed while no later milestone depends on it
-- Allowed: the person who recorded it within 24 hours, or ops manager / admin.
-- ---------------------------------------------------------------------------
create or replace function public.correct_milestone(
  p_event_id     uuid,
  p_reason       text,
  p_void         boolean default false,
  p_event_at     timestamptz default null,
  p_location     text default null,
  p_public_note  text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role    public.app_role := private.current_app_role();
  e         public.milestone_events;
  cur       public.milestone_events;
  v_reason  text := nullif(trim(p_reason), '');
  v_id      uuid;
  v_ship    jsonb;
  v_cont    record;
  v_new_at  timestamptz;
begin
  if v_role is null or v_role = 'client' then
    raise exception 'You are not allowed to correct milestones' using errcode = '42501';
  end if;

  select * into e from public.milestone_events m where m.id = p_event_id;
  if not found or not private.can_access_shipment(e.shipment_id) then
    raise exception 'Milestone not found' using errcode = 'P0002';
  end if;
  if e.correction_of_event_id is not null then
    raise exception 'Correct the original milestone, not a correction' using errcode = '22023';
  end if;
  if not (v_role in ('admin', 'ops_manager')
          or (e.recorded_by = auth.uid() and e.recorded_at > now() - interval '24 hours')) then
    raise exception 'Only the person who recorded it (within 24 hours) or an operations manager can correct this'
      using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'Give a reason for the correction' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'The reason is too long' using errcode = '22023';
  end if;

  perform 1 from public.shipments sh where sh.id = e.shipment_id for update;
  if private.is_voided(e.id) then
    raise exception 'This milestone has already been cancelled' using errcode = '55000';
  end if;

  -- latest version of the event (original or its most recent correction)
  select * into cur from public.milestone_events m
   where m.correction_of_event_id = e.id and not m.is_void
   order by m.recorded_at desc, m.id desc limit 1;
  if not found then cur := e; end if;

  if p_void then
    if e.previous_state is not null then
      -- a later status change on the same container (or shipment-wide) depends on this one
      if exists (
        select 1 from public.milestone_events l
         where l.shipment_id = e.shipment_id
           and l.correction_of_event_id is null
           and l.previous_state is not null
           and l.id <> e.id
           and (l.recorded_at, l.id) > (e.recorded_at, e.id)
           and (l.container_id is null or e.container_id is null or l.container_id = e.container_id)
           -- customs and container operations are separate tracks, except that
           -- gate-out depended on customs being released
           and ((coalesce(l.status_track, '') = 'customs') = (coalesce(e.status_track, '') = 'customs')
                or (e.status_track = 'customs' and l.milestone_type = 'gate_out'))
           and not private.is_voided(l.id)) then
        raise exception 'Later milestones depend on this one: cancel those first' using errcode = '55000';
      end if;

      v_ship := e.previous_state -> 'shipment';
      if v_ship is not null then
        update public.shipments sh set
          overall_status        = (v_ship ->> 'overall_status')::public.shipment_status,
          customs_status        = (v_ship ->> 'customs_status')::public.customs_status,
          actual_vessel_arrival = (v_ship ->> 'actual_vessel_arrival')::timestamptz
        where sh.id = e.shipment_id;
      end if;

      for v_cont in select key, value from jsonb_each(coalesce(e.previous_state -> 'containers', '{}'::jsonb)) loop
        update public.containers k set
          operational_status = (v_cont.value ->> 'operational_status')::public.shipment_status,
          transport_status   = (v_cont.value ->> 'transport_status')::public.transport_status,
          delivery_status    = (v_cont.value ->> 'delivery_status')::public.delivery_status,
          return_status      = (v_cont.value ->> 'return_status')::public.return_status,
          location_kind      = (v_cont.value ->> 'location_kind')::public.location_kind,
          location_name      = v_cont.value ->> 'location_name',
          seal_number        = v_cont.value ->> 'seal_number',
          return_depot       = v_cont.value ->> 'return_depot',
          discharge_at       = (v_cont.value ->> 'discharge_at')::timestamptz,
          gate_out_at        = (v_cont.value ->> 'gate_out_at')::timestamptz,
          delivery_at        = (v_cont.value ->> 'delivery_at')::timestamptz,
          empty_return_at    = (v_cont.value ->> 'empty_return_at')::timestamptz
        where k.id = v_cont.key::uuid;
      end loop;
    end if;

    insert into public.milestone_events (
      shipment_id, container_id, batch_id, milestone_type, status_track, previous_status, new_status,
      event_at, recorded_by, source, location, public_note, seal_number, evidence_document_ids,
      client_visible, notification_state, correction_of_event_id, correction_reason, is_void)
    values (
      e.shipment_id, e.container_id, e.batch_id, e.milestone_type, e.status_track, e.previous_status, e.new_status,
      cur.event_at, auth.uid(), 'staff', cur.location, cur.public_note, e.seal_number, e.evidence_document_ids,
      e.client_visible, 'suppressed', e.id, v_reason, true)
    returning id into v_id;
  else
    if p_event_at is null and p_location is null and p_public_note is null then
      raise exception 'Nothing to correct' using errcode = '22023';
    end if;
    v_new_at := coalesce(p_event_at, cur.event_at);
    if v_new_at > now() + interval '10 minutes' or v_new_at < now() - interval '1 year' then
      raise exception 'The event time is not valid' using errcode = '22023';
    end if;

    insert into public.milestone_events (
      shipment_id, container_id, batch_id, milestone_type, status_track, previous_status, new_status,
      event_at, recorded_by, source, location, public_note, seal_number, evidence_document_ids,
      client_visible, notification_state, correction_of_event_id, correction_reason, is_void)
    values (
      e.shipment_id, e.container_id, e.batch_id, e.milestone_type, e.status_track, e.previous_status, e.new_status,
      v_new_at, auth.uid(), 'staff',
      case when p_location is null then cur.location else left(nullif(trim(p_location), ''), 200) end,
      case when p_public_note is null then cur.public_note else left(nullif(trim(p_public_note), ''), 2000) end,
      e.seal_number, e.evidence_document_ids,
      e.client_visible, 'suppressed', e.id, v_reason, false)
    returning id into v_id;

    -- keep the event timestamps on the container/shipment in line with the corrected time
    if p_event_at is not null then
      update public.containers k set
        discharge_at    = case when e.milestone_type = 'container_discharged' and k.discharge_at = cur.event_at then v_new_at else k.discharge_at end,
        gate_out_at     = case when e.milestone_type = 'gate_out' and k.gate_out_at = cur.event_at then v_new_at else k.gate_out_at end,
        delivery_at     = case when e.milestone_type = 'delivered' and k.delivery_at = cur.event_at then v_new_at else k.delivery_at end,
        empty_return_at = case when e.milestone_type = 'empty_returned' and k.empty_return_at = cur.event_at then v_new_at else k.empty_return_at end
      where k.shipment_id = e.shipment_id and (e.container_id is null or k.id = e.container_id);
      if e.milestone_type = 'vessel_arrived' then
        update public.shipments sh set actual_vessel_arrival = v_new_at
         where sh.id = e.shipment_id and sh.actual_vessel_arrival = cur.event_at;
      end if;
    end if;
  end if;

  perform private.refresh_shipment_status(e.shipment_id);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- milestone_timeline: each original event with its latest correction applied
-- and its cancellation (if any). security_invoker → RLS of the caller applies.
-- ---------------------------------------------------------------------------
create view public.milestone_timeline with (security_invoker = true) as
select e.id, e.shipment_id, e.container_id, e.batch_id, e.milestone_type,
       e.status_track, e.previous_status, e.new_status,
       coalesce(c.event_at, e.event_at)       as event_at,
       e.event_at                             as original_event_at,
       e.recorded_at, e.recorded_by, e.source,
       coalesce(c.location, e.location)       as location,
       coalesce(c.public_note, e.public_note) as public_note,
       e.seal_number, e.evidence_document_ids, e.is_override, e.override_reason, e.client_visible,
       c.id is not null                       as is_corrected,
       c.correction_reason                    as correction_reason,
       c.recorded_at                          as corrected_at,
       c.recorded_by                          as corrected_by,
       v.id is not null                       as is_voided,
       v.correction_reason                    as void_reason,
       v.recorded_at                          as voided_at,
       v.recorded_by                          as voided_by
  from public.milestone_events e
  left join lateral (
    select c2.* from public.milestone_events c2
     where c2.correction_of_event_id = e.id and not c2.is_void
     order by c2.recorded_at desc, c2.id desc limit 1) c on true
  left join lateral (
    select v2.* from public.milestone_events v2
     where v2.correction_of_event_id = e.id and v2.is_void
     limit 1) v on true
 where e.correction_of_event_id is null;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
--   Nobody writes these tables directly: only the functions above.
-- ---------------------------------------------------------------------------
alter table public.milestone_catalogue      enable row level security;
alter table public.milestone_events         enable row level security;
alter table public.milestone_internal_notes enable row level security;

revoke all on public.milestone_catalogue, public.milestone_events,
              public.milestone_internal_notes, public.milestone_timeline
  from anon, authenticated;
grant select on public.milestone_catalogue, public.milestone_events,
                public.milestone_internal_notes, public.milestone_timeline
  to authenticated;

create policy milestone_catalogue_select on public.milestone_catalogue
  for select to authenticated
  using ((select private.current_app_role()) is not null);

-- Staff with access to the shipment; clients only client-visible events of their own shipments
create policy milestone_events_select on public.milestone_events
  for select to authenticated
  using (
    (select private.can_access_shipment(shipment_id))
    and ((select private.is_staff()) or client_visible)
  );

create policy milestone_internal_notes_select on public.milestone_internal_notes
  for select to authenticated
  using ((select private.is_staff()) and (select private.can_access_shipment(shipment_id)));

revoke all on function public.record_milestone(uuid, public.milestone_type, timestamptz, uuid[], text,
  public.location_kind, text, text, boolean, uuid[], text, text, text) from public, anon;
grant execute on function public.record_milestone(uuid, public.milestone_type, timestamptz, uuid[], text,
  public.location_kind, text, text, boolean, uuid[], text, text, text) to authenticated;

revoke all on function public.correct_milestone(uuid, text, boolean, timestamptz, text, text) from public, anon;
grant execute on function public.correct_milestone(uuid, text, boolean, timestamptz, text, text) to authenticated;

-- Internal helpers: only called from the functions/triggers above
revoke all on function private.refresh_shipment_status(uuid) from public, anon, authenticated;
revoke all on function private.on_shipment_doc_status_change() from public, anon, authenticated;
revoke all on function private.shipment_snapshot(uuid) from public, anon, authenticated;
revoke all on function private.container_snapshot(uuid) from public, anon, authenticated;
revoke all on function private.is_voided(uuid) from public, anon, authenticated;
revoke all on function private.apply_container_milestone(uuid, public.milestone_catalogue, timestamptz, text,
  public.location_kind, text, boolean) from public, anon, authenticated;
revoke all on function private.milestone_events_append_only() from public, anon, authenticated;
