-- ============================================================================
-- 0020 · Driver workspace (/driver)
--
-- Drivers are "staff" (not clients), but they are usually transporter
-- employees in the field. Until now they could read everything office staff
-- read: every user profile, every client organization, internal notes,
-- override reasons, other trucks, hidden ETA reasons and settings. This
-- migration gives drivers only what the job needs:
--
-- 1. Access: a driver reaches a shipment only through an ACTIVE truck
--    assignment of their own, and not once the shipment is closed. A
--    cancelled assignment ends access immediately. (Before: any
--    shipment_assignments row, which was never removed.)
-- 2. Milestones: drivers record only for the containers on their own truck,
--    and their notes go to NGB staff only (never a client-facing note).
-- 3. Reads: drivers are removed from the office-staff policies. They read
--    their jobs through driver_jobs() / driver_job_events(), which return
--    only what the driver needs.
-- 4. Documents: drivers see transport papers and their own uploads; their
--    uploads (photos, POD) are never shown to the client until staff decide.
-- 5. Driver's own consent to share name/phone with the client, and a
--    "report a problem" that reaches the shipment's ops owner and the
--    coordinator who assigned the truck.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- NGB office staff: every staff role except driver
create or replace function private.is_office_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_app_role() not in ('client', 'driver'), false)
$$;

-- Central shipment access rule (FRS §2); only the driver branch changes
create or replace function private.can_access_shipment(p_shipment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case private.current_app_role()
    when 'admin'           then true
    when 'ops_manager'     then true
    when 'doc_officer'     then true
    when 'transport_coord' then true
    when 'finance'         then true
    when 'clearing_agent'  then exists (
      select 1 from public.shipment_assignments a
      where a.shipment_id = p_shipment_id and a.user_id = auth.uid())
    when 'driver'          then exists (
      select 1 from public.transport_assignments a
        join public.shipments s on s.id = a.shipment_id
      where a.shipment_id = p_shipment_id and a.driver_user_id = auth.uid()
        and a.status = 'active' and s.overall_status <> 'closed')
    when 'client'          then exists (
      select 1 from public.shipments s
      where s.id = p_shipment_id and s.client_id = private.current_org_id())
    else false
  end
$$;

-- Is this container on the calling driver's active truck?
create or replace function private.driver_owns_container(p_container_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.transport_assignments a
      join public.transport_assignment_containers ac on ac.assignment_id = a.id
      join public.shipments s on s.id = a.shipment_id
     where ac.container_id = p_container_id and a.driver_user_id = auth.uid()
       and a.status = 'active' and s.overall_status <> 'closed')
$$;

-- ---------------------------------------------------------------------------
-- 2. Driver milestones: own containers only, no client-facing note
-- ---------------------------------------------------------------------------
create or replace function private.check_driver_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.current_app_role() = 'driver' then
    if new.container_id is null or not private.driver_owns_container(new.container_id) then
      raise exception 'You can only record updates for the containers on your truck' using errcode = '42501';
    end if;
    if new.public_note is not null then
      raise exception 'Notes from drivers go to NGB staff only' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger milestone_events_driver_scope
  before insert on public.milestone_events
  for each row execute function private.check_driver_event();

-- ---------------------------------------------------------------------------
-- 3. Reads: drivers out of the office-staff policies
-- ---------------------------------------------------------------------------
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_office_staff())
    -- client users can see colleagues in their own organization
    or ((select private.current_app_role()) = 'client' and organization_id = (select private.current_org_id()))
  );

drop policy organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated
  using ((select private.is_office_staff()) or id = (select private.current_org_id()));

drop policy milestone_events_select on public.milestone_events;
create policy milestone_events_select on public.milestone_events
  for select to authenticated
  using ((select private.is_office_staff()) and (select private.can_access_shipment(shipment_id)));

drop policy milestone_internal_notes_select on public.milestone_internal_notes;
create policy milestone_internal_notes_select on public.milestone_internal_notes
  for select to authenticated
  using ((select private.is_office_staff()) and (select private.can_access_shipment(shipment_id)));

drop policy transport_assignments_select on public.transport_assignments;
create policy transport_assignments_select on public.transport_assignments
  for select to authenticated
  using ((select private.is_staff()) and (select private.can_access_shipment(shipment_id))
         and ((select private.current_app_role()) <> 'driver' or driver_user_id = (select auth.uid())));

drop policy eta_revisions_select on public.eta_revisions;
create policy eta_revisions_select on public.eta_revisions
  for select to authenticated
  using ((select private.can_access_shipment(shipment_id))
         and ((select private.is_office_staff()) or client_visible));

drop policy app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings
  for select to authenticated using ((select private.is_office_staff()));

drop policy sla_rules_select on public.sla_rules;
create policy sla_rules_select on public.sla_rules
  for select to authenticated using ((select private.is_office_staff()));

-- ---------------------------------------------------------------------------
-- 4. Documents
-- ---------------------------------------------------------------------------
drop policy documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated
  using (
    (select private.can_access_shipment(shipment_id))
    and (
      (select private.is_office_staff())
      or ((select private.current_app_role()) = 'driver'
          and (uploaded_by = (select auth.uid())
               or document_type in ('delivery_order', 'release_order', 'gate_pass', 'transit_document')))
      or ((select private.current_app_role()) = 'client' and client_visible)
    )
  );

-- A driver's upload (photo, POD) reaches the client only when staff publish it
create or replace function private.driver_upload_hidden()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.current_app_role() = 'driver' then
    new.client_visible := false;
  end if;
  return new;
end;
$$;

create trigger documents_driver_upload_hidden
  before insert on public.documents
  for each row execute function private.driver_upload_hidden();

-- ---------------------------------------------------------------------------
-- 5. Driver functions
-- ---------------------------------------------------------------------------
-- The calling driver's active jobs (one row per truck assignment)
create or replace function public.driver_jobs()
returns table (
  assignment_id uuid, shipment_id uuid, shipment_reference text, client_name text,
  destination_city text, destination_country text, delivery_address text, cargo_description text,
  transporter_name text, truck_registration text, trailer_registration text,
  route_name text, border_crossing text, transit_estimate_hours integer,
  planned_loading_at timestamptz, actual_loading_at timestamptz, assigned_at timestamptz,
  ops_contact_name text, ops_contact_phone text,
  share_with_client boolean, client_allows_contact boolean,
  containers jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, s.id, s.shipment_reference, o.legal_name,
         s.destination_city, s.destination_country::text, s.delivery_address, s.cargo_description,
         a.transporter_name, a.truck_registration, a.trailer_registration,
         r.name, a.border_crossing, r.transit_estimate_hours,
         a.planned_loading_at, a.actual_loading_at, a.assigned_at,
         op.full_name, op.phone_e164,
         coalesce(dc.share_with_client, false), o.show_driver_contact,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', k.id, 'container_number', k.container_number, 'size_type', k.size_type,
                     'seal_number', k.seal_number, 'operational_status', k.operational_status,
                     'delivery_status', k.delivery_status) order by k.container_number)
                     from public.transport_assignment_containers ac
                     join public.containers k on k.id = ac.container_id
                    where ac.assignment_id = a.id), '[]'::jsonb)
    from public.transport_assignments a
    join public.shipments s on s.id = a.shipment_id
    join public.organizations o on o.id = s.client_id
    left join public.routes r on r.id = a.route_id
    left join public.profiles op on op.id = s.assigned_ops_user_id
    left join public.driver_contacts dc on dc.assignment_id = a.id
   where private.current_app_role() = 'driver'
     and a.driver_user_id = auth.uid() and a.status = 'active' and s.overall_status <> 'closed'
   order by a.assigned_at desc
$$;

-- What has been recorded on this job's containers since the truck was assigned
create or replace function public.driver_job_events(p_assignment_id uuid)
returns table (
  event_id uuid, milestone_type public.milestone_type, label text, event_at timestamptz,
  location text, container_number text, source public.event_source, recorded_by_me boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.milestone_type, c.label, t.event_at, t.location, k.container_number, t.source,
         coalesce(t.recorded_by = auth.uid(), false)
    from public.transport_assignments a
    join public.shipments s on s.id = a.shipment_id
    join public.transport_assignment_containers ac on ac.assignment_id = a.id
    join public.milestone_timeline t on t.container_id = ac.container_id
    join public.milestone_catalogue c on c.milestone_type = t.milestone_type
    join public.containers k on k.id = t.container_id
   where a.id = p_assignment_id
     and private.current_app_role() = 'driver'
     and a.driver_user_id = auth.uid() and a.status = 'active' and s.overall_status <> 'closed'
     and t.recorded_at >= a.assigned_at - interval '1 minute'
     and not t.is_voided
   order by t.event_at desc, k.container_number
   limit 200
$$;

-- The driver's own choice to share name and phone with the client
-- (the client also needs organizations.show_driver_contact; see 0015)
create or replace function public.set_my_contact_sharing(p_assignment_id uuid, p_share boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.current_app_role() is distinct from 'driver' or p_share is null then
    raise exception 'You are not allowed to change this' using errcode = '42501';
  end if;
  update public.driver_contacts dc
     set share_with_client = p_share
    from public.transport_assignments a
   where a.id = dc.assignment_id and a.id = p_assignment_id
     and a.driver_user_id = auth.uid() and a.status = 'active';
  if not found then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
end;
$$;

-- "Report a problem": a staff-only status update on the driver's containers,
-- notified to the shipment's ops owner and the coordinator who assigned the truck
insert into public.notification_rules (template_key, audience, push, whatsapp, description) values
  ('staff.driver_report', 'staff', true, false, 'A driver reported a problem on the road');

create or replace function public.driver_report_problem(
  p_assignment_id   uuid,
  p_message         text,
  p_container_ids   uuid[] default null,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a        public.transport_assignments;
  v_msg    text := nullif(trim(p_message), '');
  v_conts  uuid[];
  v_event  uuid;
  v_owner  uuid;
begin
  if private.current_app_role() is distinct from 'driver' then
    raise exception 'You are not allowed to report on this job' using errcode = '42501';
  end if;
  select * into a from public.transport_assignments t
   where t.id = p_assignment_id and t.driver_user_id = auth.uid() and t.status = 'active';
  if not found or not private.can_access_shipment(a.shipment_id) then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if v_msg is null or length(v_msg) < 3 or length(v_msg) > 1000 then
    raise exception 'Describe the problem (3 to 1000 characters)' using errcode = '22023';
  end if;
  select array_agg(ac.container_id) into v_conts
    from public.transport_assignment_containers ac
   where ac.assignment_id = a.id
     and (p_container_ids is null or cardinality(p_container_ids) = 0 or ac.container_id = any (p_container_ids));
  if v_conts is null then
    raise exception 'Choose a container on your truck' using errcode = '22023';
  end if;

  select r.event_id into v_event
    from public.record_milestone(p_shipment_id => a.shipment_id, p_milestone => 'update', p_event_at => now(),
           p_container_ids => v_conts, p_internal_note => 'Driver report: ' || v_msg,
           p_client_visible => false, p_idempotency_key => p_idempotency_key) r
   limit 1;

  select s.assigned_ops_user_id into v_owner from public.shipments s where s.id = a.shipment_id;
  perform private.enqueue_notification('driver_report:' || v_event, 'staff.driver_report', a.shipment_id,
    private.shipment_payload(a.shipment_id) || jsonb_build_object(
      'shipment_id', a.shipment_id, 'truck', a.truck_registration, 'message', left(v_msg, 300),
      'containers', (select jsonb_agg(k.container_number order by k.container_number)
                       from public.containers k where k.id = any (v_conts))),
    array(select distinct x from unnest(array[v_owner, a.assigned_by]) x where x is not null));
  return v_event;
end;
$$;

revoke all on function public.driver_jobs() from public, anon;
revoke all on function public.driver_job_events(uuid) from public, anon;
revoke all on function public.set_my_contact_sharing(uuid, boolean) from public, anon;
revoke all on function public.driver_report_problem(uuid, text, uuid[], text) from public, anon;
grant execute on function public.driver_jobs() to authenticated;
grant execute on function public.driver_job_events(uuid) to authenticated;
grant execute on function public.set_my_contact_sharing(uuid, boolean) to authenticated;
grant execute on function public.driver_report_problem(uuid, text, uuid[], text) to authenticated;
