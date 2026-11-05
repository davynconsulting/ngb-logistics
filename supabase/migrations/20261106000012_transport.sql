-- ============================================================================
-- 0012 · Routes and transport assignment (FRS §3 steps 6-9, §6.5)
--   • routes: configurable origin → destination with border and transit
--     estimate (used for transit SLAs in 0013).
--   • transport_assignments: truck/trailer/transporter/route for one or more
--     containers. Created only by assign_transport(), which also records the
--     "Truck assigned" milestone through record_milestone() (same rules).
--   • driver_contacts: driver name/phone in a separate staff-only table, so
--     client-facing reads can never include driver personal data (FRS §7, §9).
--   • Gate-out needs an active truck assignment for the container (agreed rule),
--     in addition to customs release (0010).
-- ============================================================================

create table public.routes (
  id                      uuid primary key default gen_random_uuid(),
  code                    text not null unique check (code ~ '^[A-Z0-9-]{3,30}$'),
  name                    text not null check (length(name) between 3 and 120),
  origin_port_id          uuid not null references public.ports (id),
  destination_country     char(2) not null check (destination_country ~ '^[A-Z]{2}$'),
  destination_city        text not null,
  border_crossing         text,
  transit_estimate_hours  integer not null check (transit_estimate_hours between 1 and 720),
  checkpoint_alert_hours  integer not null default 24 check (checkpoint_alert_hours between 1 and 240),
  is_active               boolean not null default true,
  created_at              timestamptz not null default now()
);

-- Reference routes with typical estimates (FRS §12: about 3 days to Rwanda).
-- Estimates are defaults for NGB to adjust; they are configuration, not test data.
insert into public.routes (code, name, origin_port_id, destination_country, destination_city, border_crossing, transit_estimate_hours)
select v.code, v.name, p.id, v.country, v.city, v.border, v.hours
from (values
  ('DAR-KGL', 'Dar es Salaam → Kigali via Rusumo', 'TZDAR', 'RW', 'Kigali', 'Rusumo', 72),
  ('DAR-BJM', 'Dar es Salaam → Bujumbura via Kabanga/Kobero', 'TZDAR', 'BI', 'Bujumbura', 'Kabanga/Kobero', 96),
  ('MBA-KGL', 'Mombasa → Kigali via Malaba and Gatuna', 'KEMBA', 'RW', 'Kigali', 'Malaba; Gatuna', 120),
  ('MBA-KLA', 'Mombasa → Kampala via Malaba', 'KEMBA', 'UG', 'Kampala', 'Malaba', 72)
) as v(code, name, port, country, city, border, hours)
join public.ports p on p.code = v.port;

create type public.assignment_status as enum ('active', 'cancelled');

create table public.transport_assignments (
  id                     uuid primary key default gen_random_uuid(),
  shipment_id            uuid not null references public.shipments (id) on delete restrict,
  transporter_name       text not null check (length(transporter_name) between 2 and 120),
  truck_registration     text not null check (truck_registration ~ '^[A-Z0-9 -]{3,20}$'),
  trailer_registration   text check (trailer_registration ~ '^[A-Z0-9 -]{3,20}$'),
  route_id               uuid references public.routes (id),
  border_crossing        text check (length(border_crossing) <= 120),
  planned_loading_at     timestamptz,
  actual_loading_at      timestamptz,
  transit_document_refs  text[] not null default '{}' check (cardinality(transit_document_refs) <= 10),
  driver_user_id         uuid references public.profiles (id),
  status                 public.assignment_status not null default 'active',
  assigned_by            uuid references public.profiles (id) default auth.uid(),
  assigned_at            timestamptz not null default now(),
  cancelled_by           uuid references public.profiles (id),
  cancelled_at           timestamptz,
  cancel_reason          text check (length(cancel_reason) <= 500),
  constraint cancelled_has_reason check (status = 'active' or cancel_reason is not null)
);
create index transport_assignments_shipment_idx on public.transport_assignments (shipment_id);

create table public.transport_assignment_containers (
  assignment_id  uuid not null references public.transport_assignments (id) on delete restrict,
  container_id   uuid not null references public.containers (id) on delete restrict,
  primary key (assignment_id, container_id)
);
create index transport_assignment_containers_container_idx on public.transport_assignment_containers (container_id);

-- Driver personal data: staff (and the assigned driver) only
create table public.driver_contacts (
  assignment_id  uuid primary key references public.transport_assignments (id) on delete restrict,
  driver_name    text not null check (length(driver_name) between 2 and 120),
  driver_phone   text check (driver_phone ~ '^\+[1-9][0-9]{6,14}$')
);

create trigger audit_routes after insert or update or delete on public.routes
  for each row execute function private.audit_row();
create trigger audit_transport_assignments after insert or update or delete on public.transport_assignments
  for each row execute function private.audit_row();
create trigger audit_driver_contacts after insert or update or delete on public.driver_contacts
  for each row execute function private.audit_row();
create trigger transport_assignment_containers_append_only
  before update or delete on public.transport_assignment_containers
  for each row execute function private.prevent_mutation();

-- The active assignment for a container (at most one, enforced in assign_transport)
create or replace function private.active_assignment(p_container_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id from public.transport_assignments a
    join public.transport_assignment_containers ac on ac.assignment_id = a.id
   where ac.container_id = p_container_id and a.status = 'active'
   order by a.assigned_at desc limit 1
$$;

-- Gate-out needs a truck (unless the ops manager overrode the workflow)
create or replace function private.gate_out_needs_truck()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.milestone_type = 'gate_out' and new.container_id is not null
     and new.correction_of_event_id is null and not new.is_override
     and private.active_assignment(new.container_id) is null then
    raise exception 'Assign a truck to % before gate-out',
      (select c.container_number from public.containers c where c.id = new.container_id)
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger milestone_events_gate_out_needs_truck
  before insert on public.milestone_events
  for each row execute function private.gate_out_needs_truck();

-- "Loaded" milestone fills in the assignment's actual loading time
create or replace function private.record_actual_loading()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.milestone_type = 'loaded' and new.container_id is not null and new.correction_of_event_id is null then
    update public.transport_assignments a
       set actual_loading_at = coalesce(a.actual_loading_at, new.event_at)
     where a.id = private.active_assignment(new.container_id);
  end if;
  return null;
end;
$$;

create trigger milestone_events_actual_loading
  after insert on public.milestone_events
  for each row execute function private.record_actual_loading();

-- ---------------------------------------------------------------------------
-- assign_transport: one truck for one or more containers of a shipment.
--   Containers that are ready for dispatch get the "Truck assigned" milestone
--   (through record_milestone, so role and transition rules apply; an
--   override reason is passed through). Containers that already had a truck
--   (cancelled assignment, not yet gated out) are re-assigned with an update.
-- ---------------------------------------------------------------------------
create or replace function public.assign_transport(
  p_shipment_id           uuid,
  p_container_ids         uuid[],
  p_transporter_name      text,
  p_truck_registration    text,
  p_trailer_registration  text default null,
  p_driver_name           text default null,
  p_driver_phone          text default null,
  p_driver_user_id        uuid default null,
  p_route_id              uuid default null,
  p_border_crossing       text default null,
  p_planned_loading_at    timestamptz default null,
  p_transit_document_refs text[] default null,
  p_override_reason       text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role     public.app_role := private.current_app_role();
  v_targets  uuid[];
  v_new      uuid[];
  v_re       uuid[];
  v_truck    text := upper(regexp_replace(trim(coalesce(p_truck_registration, '')), '\s+', ' ', 'g'));
  v_trailer  text := nullif(upper(regexp_replace(trim(coalesce(p_trailer_registration, '')), '\s+', ' ', 'g')), '');
  v_carrier  text := nullif(trim(p_transporter_name), '');
  v_driver   text := nullif(trim(p_driver_name), '');
  v_phone    text := nullif(regexp_replace(coalesce(p_driver_phone, ''), '[\s().-]', '', 'g'), '');
  v_border   text := nullif(trim(p_border_crossing), '');
  v_refs     text[];
  v_id       uuid;
  v_note     text;
  k          record;
begin
  if v_role is null or v_role not in ('admin', 'ops_manager', 'transport_coord') then
    raise exception 'You are not allowed to assign transport' using errcode = '42501';
  end if;
  if not private.can_access_shipment(p_shipment_id) then
    raise exception 'Shipment not found' using errcode = 'P0002';
  end if;
  perform 1 from public.shipments sh where sh.id = p_shipment_id for update;

  select array_agg(distinct x) into v_targets from unnest(coalesce(p_container_ids, '{}')) x;
  if v_targets is null then
    raise exception 'Choose at least one container' using errcode = '22023';
  end if;
  if (select count(*) from public.containers c where c.id = any (v_targets) and c.shipment_id = p_shipment_id) <> cardinality(v_targets) then
    raise exception 'A container is not on this shipment' using errcode = '22023';
  end if;
  if v_carrier is null then
    raise exception 'Enter the transporter' using errcode = '22023';
  end if;
  if v_truck !~ '^[A-Z0-9 -]{3,20}$' then
    raise exception 'Enter a valid truck registration' using errcode = '22023';
  end if;
  if v_trailer is not null and v_trailer !~ '^[A-Z0-9 -]{3,20}$' then
    raise exception 'Enter a valid trailer registration' using errcode = '22023';
  end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'Use international format for the driver phone, e.g. +250788123456' using errcode = '22023';
  end if;
  if (v_phone is not null or p_driver_user_id is not null) and v_driver is null then
    raise exception 'Enter the driver name' using errcode = '22023';
  end if;
  if p_driver_user_id is not null and not exists (
       select 1 from public.profiles p where p.id = p_driver_user_id and p.role = 'driver' and p.is_active) then
    raise exception 'The selected driver is not an active driver user' using errcode = '22023';
  end if;
  if p_route_id is not null and not exists (select 1 from public.routes r where r.id = p_route_id and r.is_active) then
    raise exception 'Choose an active route' using errcode = '22023';
  end if;
  if p_planned_loading_at is not null and
     (p_planned_loading_at < now() - interval '7 days' or p_planned_loading_at > now() + interval '90 days') then
    raise exception 'The planned loading time is not valid' using errcode = '22023';
  end if;
  select coalesce(array_agg(nullif(trim(r), '')) filter (where nullif(trim(r), '') is not null), '{}')
    into v_refs from unnest(coalesce(p_transit_document_refs, '{}')) r;
  if cardinality(v_refs) > 10 or exists (select 1 from unnest(v_refs) r where length(r) > 60) then
    raise exception 'Too many or too long transit document references' using errcode = '22023';
  end if;

  -- which containers get a first truck, which a replacement; none may already have one
  for k in select c.id, c.container_number, c.operational_status from public.containers c
            where c.id = any (v_targets) order by c.container_number loop
    if private.active_assignment(k.id) is not null then
      raise exception 'Container % already has a truck. Cancel that assignment first', k.container_number
        using errcode = '55000';
    end if;
    if k.operational_status >= 'in_transit' then
      raise exception 'Container % has already left (gate-out)', k.container_number using errcode = '55000';
    end if;
    if k.operational_status in ('truck_assigned', 'loading', 'loaded') then
      v_re := coalesce(v_re, '{}') || k.id;
    else
      v_new := coalesce(v_new, '{}') || k.id;
    end if;
  end loop;

  insert into public.transport_assignments (shipment_id, transporter_name, truck_registration, trailer_registration,
    route_id, border_crossing, planned_loading_at, transit_document_refs, driver_user_id)
  values (p_shipment_id, v_carrier, v_truck, v_trailer, p_route_id,
    coalesce(v_border, (select r.border_crossing from public.routes r where r.id = p_route_id)),
    p_planned_loading_at, v_refs, p_driver_user_id)
  returning id into v_id;

  insert into public.transport_assignment_containers (assignment_id, container_id)
  select v_id, x from unnest(v_targets) x;

  if v_driver is not null then
    insert into public.driver_contacts (assignment_id, driver_name, driver_phone) values (v_id, v_driver, v_phone);
  end if;
  -- the driver user can then see the shipment (assigned-only access)
  if p_driver_user_id is not null then
    insert into public.shipment_assignments (shipment_id, user_id) values (p_shipment_id, p_driver_user_id)
    on conflict do nothing;
  end if;

  v_note := format('Truck %s (%s)%s', v_truck, v_carrier,
    case when p_planned_loading_at is not null then ', loading planned' else '' end);
  if v_new is not null then
    perform public.record_milestone(p_shipment_id => p_shipment_id, p_milestone => 'truck_assigned',
      p_event_at => now(), p_container_ids => v_new, p_public_note => v_note,
      p_override_reason => p_override_reason);
  end if;
  if v_re is not null then
    perform public.record_milestone(p_shipment_id => p_shipment_id, p_milestone => 'update',
      p_event_at => now(), p_container_ids => v_re, p_public_note => 'Truck changed: ' || v_note);
  end if;
  return v_id;
end;
$$;

-- Cancel a truck assignment before gate-out (truck broke down, no-show…)
create or replace function public.cancel_transport_assignment(p_assignment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role    public.app_role := private.current_app_role();
  a         public.transport_assignments;
  v_reason  text := nullif(trim(p_reason), '');
  v_conts   uuid[];
begin
  if v_role is null or v_role not in ('admin', 'ops_manager', 'transport_coord') then
    raise exception 'You are not allowed to change transport' using errcode = '42501';
  end if;
  select * into a from public.transport_assignments t where t.id = p_assignment_id;
  if not found or not private.can_access_shipment(a.shipment_id) then
    raise exception 'Assignment not found' using errcode = 'P0002';
  end if;
  perform 1 from public.shipments sh where sh.id = a.shipment_id for update;
  if a.status <> 'active' then
    raise exception 'This assignment is already cancelled' using errcode = '55000';
  end if;
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'Give a reason (3 to 500 characters)' using errcode = '22023';
  end if;
  select array_agg(ac.container_id) into v_conts from public.transport_assignment_containers ac where ac.assignment_id = a.id;
  if exists (select 1 from public.containers c where c.id = any (v_conts) and c.operational_status >= 'in_transit') then
    raise exception 'The truck has already left with a container; record transit updates instead' using errcode = '55000';
  end if;

  update public.transport_assignments t
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = v_reason
   where t.id = a.id;

  perform public.record_milestone(p_shipment_id => a.shipment_id, p_milestone => 'update', p_event_at => now(),
    p_container_ids => v_conts, p_public_note => format('Truck %s cancelled; a new truck will be assigned', a.truck_registration),
    p_internal_note => 'Reason: ' || v_reason, p_client_visible => false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
alter table public.routes                          enable row level security;
alter table public.transport_assignments           enable row level security;
alter table public.transport_assignment_containers enable row level security;
alter table public.driver_contacts                 enable row level security;

revoke all on public.routes, public.transport_assignments, public.transport_assignment_containers,
              public.driver_contacts from anon, authenticated;
grant select on public.routes, public.transport_assignments, public.transport_assignment_containers,
                public.driver_contacts to authenticated;
-- routes are configured by admins/ops managers
grant insert (code, name, origin_port_id, destination_country, destination_city, border_crossing,
              transit_estimate_hours, checkpoint_alert_hours, is_active) on public.routes to authenticated;
grant update (name, border_crossing, transit_estimate_hours, checkpoint_alert_hours, is_active) on public.routes to authenticated;
-- details that may change while the assignment is active (status/containers only via the functions)
grant update (trailer_registration, border_crossing, planned_loading_at, transit_document_refs)
  on public.transport_assignments to authenticated;
grant update (driver_name, driver_phone) on public.driver_contacts to authenticated;

create policy routes_select on public.routes for select to authenticated
  using ((select private.is_staff()));
create policy routes_insert on public.routes for insert to authenticated
  with check ((select private.has_role('admin', 'ops_manager')));
create policy routes_update on public.routes for update to authenticated
  using ((select private.has_role('admin', 'ops_manager'))) with check ((select private.has_role('admin', 'ops_manager')));

-- Truck/transporter/route are part of the client's tracking view (no personal data here)
create policy transport_assignments_select on public.transport_assignments for select to authenticated
  using ((select private.can_access_shipment(shipment_id)));
create policy transport_assignments_update on public.transport_assignments for update to authenticated
  using (status = 'active' and (select private.has_role('admin', 'ops_manager', 'transport_coord'))
         and (select private.can_access_shipment(shipment_id)))
  with check (status = 'active');

create policy transport_assignment_containers_select on public.transport_assignment_containers for select to authenticated
  using (exists (select 1 from public.transport_assignments a
                 where a.id = assignment_id and (select private.can_access_shipment(a.shipment_id))));

-- staff with access to the shipment (drivers: only their own assignment); never clients
create policy driver_contacts_select on public.driver_contacts for select to authenticated
  using (exists (select 1 from public.transport_assignments a
                 where a.id = assignment_id
                   and (select private.is_staff())
                   and (select private.can_access_shipment(a.shipment_id))
                   and ((select private.current_app_role()) <> 'driver' or a.driver_user_id = (select auth.uid()))));
create policy driver_contacts_update on public.driver_contacts for update to authenticated
  using (exists (select 1 from public.transport_assignments a
                 where a.id = assignment_id and a.status = 'active'
                   and (select private.has_role('admin', 'ops_manager', 'transport_coord'))
                   and (select private.can_access_shipment(a.shipment_id))));

revoke all on function public.assign_transport(uuid, uuid[], text, text, text, text, text, uuid, uuid, text, timestamptz, text[], text) from public, anon;
grant execute on function public.assign_transport(uuid, uuid[], text, text, text, text, text, uuid, uuid, text, timestamptz, text[], text) to authenticated;
revoke all on function public.cancel_transport_assignment(uuid, text) from public, anon;
grant execute on function public.cancel_transport_assignment(uuid, text) to authenticated;
revoke all on function private.active_assignment(uuid) from public, anon, authenticated;
revoke all on function private.gate_out_needs_truck() from public, anon, authenticated;
revoke all on function private.record_actual_loading() from public, anon, authenticated;
