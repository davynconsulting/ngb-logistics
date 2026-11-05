-- ============================================================================
-- 0015 · Client portal access
--
-- 1. Client-safe reads. RLS works per row, not per column, so since 0010/0012
--    a client could read internal text on rows it may see: override,
--    correction and cancellation reasons on milestone events, and the cancel
--    reason on truck assignments. Those tables become staff-only; clients
--    read through functions that return only client-safe columns:
--      client_timeline · client_transport · client_shipment_alerts
-- 2. Clients may upload the commercial documents NGB asks for (BL, invoice,
--    packing list, certificate of origin, other); they arrive as pending
--    review and the responsible staff member is notified.
-- 3. Driver contact for clients needs BOTH the client organization's policy
--    (organizations.show_driver_contact, admin-set) AND the driver's consent
--    on that assignment (driver_contacts.share_with_client). Off by default.
-- 4. Staff can publish a client message on an exception (shown in the portal
--    and notified) without exposing the internal details.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Staff-only base tables + client-safe functions
-- ---------------------------------------------------------------------------
-- driver consent column first: client_transport() below reads it
alter table public.driver_contacts add column share_with_client boolean not null default false;
grant update (share_with_client) on public.driver_contacts to authenticated;

drop policy milestone_events_select on public.milestone_events;
create policy milestone_events_select on public.milestone_events
  for select to authenticated
  using ((select private.is_staff()) and (select private.can_access_shipment(shipment_id)));

drop policy transport_assignments_select on public.transport_assignments;
create policy transport_assignments_select on public.transport_assignments
  for select to authenticated
  using ((select private.is_staff()) and (select private.can_access_shipment(shipment_id)));

-- Timeline for the client: client-visible, not cancelled, latest correction applied
create or replace function public.client_timeline(p_shipment_id uuid)
returns table (
  batch_id uuid, milestone_type public.milestone_type, label text, event_at timestamptz,
  location text, public_note text, containers text[], is_corrected boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.batch_id, t.milestone_type, c.label, max(t.event_at), max(t.location), max(t.public_note),
         array_remove(array_agg(k.container_number order by k.container_number), null),
         bool_or(t.is_corrected)
    from public.milestone_timeline t
    join public.milestone_catalogue c on c.milestone_type = t.milestone_type
    left join public.containers k on k.id = t.container_id
   where t.shipment_id = p_shipment_id
     and t.client_visible and not t.is_voided
     and private.can_access_shipment(p_shipment_id)
   group by t.batch_id, t.milestone_type, c.label
   order by max(t.event_at) desc
$$;

-- Trucks for the client (active assignments only; no cancel reasons)
create or replace function public.client_transport(p_shipment_id uuid)
returns table (
  assignment_id uuid, transporter_name text, truck_registration text, trailer_registration text,
  route_name text, border_crossing text, transit_estimate_hours integer,
  planned_loading_at timestamptz, actual_loading_at timestamptz, containers text[],
  driver_name text, driver_phone text
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.transporter_name, a.truck_registration, a.trailer_registration,
         r.name, a.border_crossing, r.transit_estimate_hours,
         a.planned_loading_at, a.actual_loading_at,
         (select array_agg(k.container_number order by k.container_number)
            from public.transport_assignment_containers ac join public.containers k on k.id = ac.container_id
           where ac.assignment_id = a.id),
         case when share.ok then dc.driver_name end,
         case when share.ok then dc.driver_phone end
    from public.transport_assignments a
    join public.shipments s on s.id = a.shipment_id
    join public.organizations o on o.id = s.client_id
    left join public.routes r on r.id = a.route_id
    left join public.driver_contacts dc on dc.assignment_id = a.id
    cross join lateral (select coalesce(o.show_driver_contact, false) and coalesce(dc.share_with_client, false) as ok) share
   where a.shipment_id = p_shipment_id and a.status = 'active'
     and private.can_access_shipment(p_shipment_id)
   order by a.assigned_at desc
$$;

-- Open exceptions the client should know about: the client message only
create or replace function public.client_shipment_alerts(p_shipment_id uuid)
returns table (alert_id uuid, exception_type public.exception_type, message text, opened_at timestamptz, container_number text)
language sql
stable
security definer
set search_path = ''
as $$
  select x.id, x.exception_type, x.client_message, x.opened_at, k.container_number
    from public.exceptions x
    left join public.containers k on k.id = x.container_id
   where x.shipment_id = p_shipment_id and x.status = 'open'
     and x.client_visible and x.client_message is not null
     and private.can_access_shipment(p_shipment_id)
   order by x.opened_at desc
$$;

-- ---------------------------------------------------------------------------
-- 2. Client uploads of commercial documents
-- ---------------------------------------------------------------------------
drop policy documents_insert on public.documents;
create policy documents_insert on public.documents
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and (select private.can_access_shipment(shipment_id))
    and (
      (select private.has_role('admin', 'ops_manager', 'doc_officer'))
      or ((select private.has_role('clearing_agent', 'driver'))
          and document_type in ('customs_entry', 'release_order', 'gate_pass',
                                'transit_document', 'proof_of_delivery',
                                'container_return_receipt', 'photo', 'other'))
      -- clients: the documents NGB asks them for; always visible to them
      or ((select private.has_role('client'))
          and document_type in ('bill_of_lading', 'commercial_invoice', 'packing_list',
                                'certificate_of_origin', 'other')
          and client_visible)
    )
  );

drop policy shipment_documents_upload on storage.objects;
create policy shipment_documents_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'shipment-documents'
    and (select private.has_role('admin', 'ops_manager', 'doc_officer',
                                 'clearing_agent', 'driver', 'client'))
    and private.can_access_shipment(private.try_uuid((storage.foldername(name))[2]))
    and exists (
      select 1 from public.shipments s
      where s.id = private.try_uuid((storage.foldername(name))[2])
        and s.client_id = private.try_uuid((storage.foldername(name))[1])
    )
  );

-- Clients now upload too, so they get the "not uploaded yet" message as well.
-- The message is only given for shipments the caller can access; for anyone
-- else the insert policy refuses it, so it never hints which files exist.
create or replace function private.take_file_facts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_size bigint;
  v_mime text;
begin
  select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype'
    into v_size, v_mime
    from storage.objects o
   where o.bucket_id = 'shipment-documents'
     and o.name = new.storage_path;

  if v_size is null then
    if auth.uid() is null
       or (private.has_role('admin', 'ops_manager', 'doc_officer', 'clearing_agent', 'driver', 'client')
           and private.can_access_shipment(new.shipment_id)) then
      raise exception 'The file has not been uploaded' using errcode = 'P0002';
    end if;
    return new;
  end if;

  new.size_bytes := v_size;
  new.mime_type  := v_mime;
  return new;
end;
$$;

-- the responsible staff member hears about a client upload
insert into public.notification_rules (template_key, audience, push, whatsapp, description) values
  ('staff.client_uploaded', 'staff', true, false, 'A client uploaded a document for review');

create or replace function private.notify_client_upload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if private.current_app_role() = 'client' then
    select s.assigned_ops_user_id into v_owner from public.shipments s where s.id = new.shipment_id;
    perform private.enqueue_notification('client_upload:' || new.id, 'staff.client_uploaded', new.shipment_id,
      jsonb_build_object('shipment_id', new.shipment_id, 'document_type', new.document_type, 'file_name', new.file_name,
        'reference', (select s.shipment_reference from public.shipments s where s.id = new.shipment_id)),
      array_remove(array[v_owner], null));
  end if;
  return null;
end;
$$;

create trigger documents_notify_client_upload
  after insert on public.documents
  for each row execute function private.notify_client_upload();

-- ---------------------------------------------------------------------------
-- 3. Driver consent to share contact with the client
-- ---------------------------------------------------------------------------
-- (share_with_client is added at the top of this migration)

-- ---------------------------------------------------------------------------
-- 4. Client message on an exception (owner or operations manager/admin)
-- ---------------------------------------------------------------------------
create or replace function public.set_exception_client_message(p_exception_id uuid, p_message text, p_visible boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  x      public.exceptions := private.exception_for_staff(p_exception_id);
  v_msg  text := nullif(trim(p_message), '');
begin
  if not (private.has_role('admin', 'ops_manager') or x.owner_id = auth.uid()) then
    raise exception 'Only the owner or an operations manager can message the client' using errcode = '42501';
  end if;
  if x.status <> 'open' then
    raise exception 'This exception is resolved' using errcode = '55000';
  end if;
  if coalesce(p_visible, false) and (v_msg is null or length(v_msg) < 5) then
    raise exception 'Write the message the client will see' using errcode = '22023';
  end if;
  if length(v_msg) > 500 then
    raise exception 'The message is too long' using errcode = '22023';
  end if;
  update public.exceptions e
     set client_message = coalesce(v_msg, e.client_message), client_visible = coalesce(p_visible, false), updated_at = now()
   where e.id = x.id;
  insert into public.exception_updates (exception_id, kind, note, data)
  values (x.id, 'note', case when coalesce(p_visible, false) then 'Client informed: ' || v_msg else 'Hidden from the client' end,
          jsonb_build_object('client_visible', coalesce(p_visible, false)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.client_timeline(uuid)', 'public.client_transport(uuid)', 'public.client_shipment_alerts(uuid)',
    'public.set_exception_client_message(uuid, text, boolean)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke all on function private.notify_client_upload() from public, anon, authenticated';
  execute 'revoke all on function private.take_file_facts() from public, anon, authenticated';
end;
$$;
