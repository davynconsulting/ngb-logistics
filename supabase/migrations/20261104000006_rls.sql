-- ============================================================================
-- 0006 · Row Level Security, privileges and storage policies
-- FRS §2 security requirement, AC-05 (client isolation), AC-16 (document access)
--
-- Principles
--  * RLS is enabled on every table; there are no USING (true) policies.
--  * The anon role (not signed in) gets no access to application tables.
--  * Column privileges stop users writing status columns directly; status
--    changes will go through controlled RPC functions (Sprint 2).
--  * Helper functions live in the unexposed `private` schema.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper functions. SECURITY DEFINER so they can read profiles without
-- recursive RLS; STABLE so Postgres can cache them within a statement.
-- An inactive or unknown user gets NULL role → no access anywhere.
-- ---------------------------------------------------------------------------
create or replace function private.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.is_active
$$;

create or replace function private.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.organization_id from public.profiles p
  where p.id = auth.uid() and p.is_active
$$;

create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_app_role() <> 'client', false)
$$;

create or replace function private.has_role(variadic roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_app_role() = any (roles), false)
$$;

-- Central shipment access rule (FRS §2):
--   admin, ops_manager, doc_officer, transport_coord, finance → all shipments
--   clearing_agent, driver → only shipments assigned to them
--   client → only their organization's shipments
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
      select 1 from public.shipment_assignments a
      where a.shipment_id = p_shipment_id and a.user_id = auth.uid())
    when 'client'          then exists (
      select 1 from public.shipments s
      where s.id = p_shipment_id and s.client_id = private.current_org_id())
    else false
  end
$$;

-- Safe uuid parsing for storage paths (returns NULL instead of erroring)
create or replace function private.try_uuid(p text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Baseline privileges: nobody anonymous; signed-in users get only what is
-- granted below (and RLS still filters every row).
-- ---------------------------------------------------------------------------
revoke all on
  public.organizations, public.profiles, public.notification_preferences,
  public.ports, public.shipments, public.containers, public.shipment_assignments,
  public.documents, public.document_requirements, public.audit_log
from anon, authenticated;

revoke all on all tables in schema private from public, anon, authenticated;

alter table public.organizations          enable row level security;
alter table public.profiles               enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.ports                  enable row level security;
alter table public.shipments              enable row level security;
alter table public.containers             enable row level security;
alter table public.shipment_assignments   enable row level security;
alter table public.documents              enable row level security;
alter table public.document_requirements  enable row level security;
alter table public.audit_log              enable row level security;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
grant select on public.organizations to authenticated;
grant insert (client_code, legal_name, primary_contact_name, phone_e164, email,
              billing_address, tax_id, preferred_language, timezone,
              billing_terms_days, credit_limit, credit_currency,
              account_manager_id, show_driver_contact)
  on public.organizations to authenticated;
grant update (legal_name, primary_contact_name, phone_e164, email,
              billing_address, tax_id, preferred_language, timezone,
              billing_terms_days, credit_limit, credit_currency,
              account_manager_id, show_driver_contact, is_active)
  on public.organizations to authenticated;

create policy organizations_select on public.organizations
  for select to authenticated
  using ((select private.is_staff()) or id = (select private.current_org_id()));

create policy organizations_insert on public.organizations
  for insert to authenticated
  with check ((select private.has_role('admin', 'ops_manager')));

create policy organizations_update on public.organizations
  for update to authenticated
  using ((select private.has_role('admin', 'ops_manager')))
  with check ((select private.has_role('admin', 'ops_manager')));

-- ---------------------------------------------------------------------------
-- profiles. Created only by the auth trigger. Role / organization / active
-- changes are admin operations performed server-side with the service role
-- after an admin permission check. Users may edit their own name and phone.
-- ---------------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (full_name, phone_e164) on public.profiles to authenticated;

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_staff())
    -- client users can see colleagues in their own organization
    or organization_id = (select private.current_org_id())
  );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- notification_preferences: own row only; admins/ops can read for support
-- ---------------------------------------------------------------------------
grant select on public.notification_preferences to authenticated;
grant update (push_enabled, whatsapp_opt_in, whatsapp_phone, consent_at,
              consent_source, locale)
  on public.notification_preferences to authenticated;

create policy notification_preferences_select on public.notification_preferences
  for select to authenticated
  using (user_id = (select auth.uid())
         or (select private.has_role('admin', 'ops_manager')));

create policy notification_preferences_update on public.notification_preferences
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- ports (configuration): everyone signed in may read; admins manage
-- ---------------------------------------------------------------------------
grant select on public.ports to authenticated;
grant insert (code, name, country, is_active) on public.ports to authenticated;
grant update (name, country, is_active) on public.ports to authenticated;

create policy ports_select on public.ports
  for select to authenticated
  using ((select private.current_app_role()) is not null);

create policy ports_insert on public.ports
  for insert to authenticated
  with check ((select private.has_role('admin')));

create policy ports_update on public.ports
  for update to authenticated
  using ((select private.has_role('admin')))
  with check ((select private.has_role('admin')));

-- ---------------------------------------------------------------------------
-- shipments
--   read:   can_access_shipment (clients: own org; agents/drivers: assigned)
--   create: admin, ops_manager, doc_officer
--   edit:   same roles, descriptive fields only. Reference, client and all
--           status columns are NOT writable by users.
-- ---------------------------------------------------------------------------
grant select on public.shipments to authenticated;
grant insert (client_id, booking_reference, bl_number, shipping_line, vessel_name,
              voyage_number, origin_port_id, origin_terminal, destination_country,
              destination_city, delivery_address, cargo_description, package_count,
              gross_weight_kg, planned_vessel_arrival, assigned_ops_user_id)
  on public.shipments to authenticated;
grant update (booking_reference, bl_number, shipping_line, vessel_name,
              voyage_number, origin_port_id, origin_terminal, destination_country,
              destination_city, delivery_address, cargo_description, package_count,
              gross_weight_kg, planned_vessel_arrival, assigned_ops_user_id)
  on public.shipments to authenticated;

create policy shipments_select on public.shipments
  for select to authenticated
  using ((select private.can_access_shipment(id)));

create policy shipments_insert on public.shipments
  for insert to authenticated
  with check ((select private.has_role('admin', 'ops_manager', 'doc_officer')));

create policy shipments_update on public.shipments
  for update to authenticated
  using ((select private.has_role('admin', 'ops_manager', 'doc_officer')))
  with check ((select private.has_role('admin', 'ops_manager', 'doc_officer')));

-- ---------------------------------------------------------------------------
-- containers: same pattern; event timestamps and statuses are not writable
-- ---------------------------------------------------------------------------
grant select on public.containers to authenticated;
grant insert (shipment_id, container_number, size_type, seal_number,
              location_kind, location_name, return_depot, return_deadline)
  on public.containers to authenticated;
grant update (container_number, size_type, seal_number, location_kind,
              location_name, condition, return_depot, return_deadline)
  on public.containers to authenticated;

create policy containers_select on public.containers
  for select to authenticated
  using ((select private.can_access_shipment(shipment_id)));

create policy containers_insert on public.containers
  for insert to authenticated
  with check ((select private.has_role('admin', 'ops_manager', 'doc_officer')));

create policy containers_update on public.containers
  for update to authenticated
  using ((select private.has_role('admin', 'ops_manager', 'doc_officer')))
  with check ((select private.has_role('admin', 'ops_manager', 'doc_officer')));

-- ---------------------------------------------------------------------------
-- shipment_assignments: managed by admin / ops / transport coordinator;
-- assigned users can see their own assignments
-- ---------------------------------------------------------------------------
grant select, delete on public.shipment_assignments to authenticated;
grant insert (shipment_id, user_id) on public.shipment_assignments to authenticated;

create policy shipment_assignments_select on public.shipment_assignments
  for select to authenticated
  using (user_id = (select auth.uid())
         or (select private.has_role('admin', 'ops_manager', 'transport_coord', 'doc_officer')));

create policy shipment_assignments_insert on public.shipment_assignments
  for insert to authenticated
  with check ((select private.has_role('admin', 'ops_manager', 'transport_coord')));

create policy shipment_assignments_delete on public.shipment_assignments
  for delete to authenticated
  using ((select private.has_role('admin', 'ops_manager', 'transport_coord')));

-- ---------------------------------------------------------------------------
-- documents
--   read:   staff with shipment access; clients only client_visible documents
--   upload: admin / ops / doc officer; clearing agents and drivers for their
--           assigned shipments (evidence). Uploader is always the caller.
--   verify: admin / ops / doc officer (verification columns only)
--   delete: never (versioning instead)
-- ---------------------------------------------------------------------------
grant select on public.documents to authenticated;
grant insert (id, shipment_id, container_id, document_type, storage_path, file_name,
              mime_type, size_bytes, version, replaces_document_id, client_visible)
  on public.documents to authenticated;
grant update (verification_status, verified_by, verified_at, rejection_reason,
              client_visible)
  on public.documents to authenticated;

create policy documents_select on public.documents
  for select to authenticated
  using (
    (select private.can_access_shipment(shipment_id))
    and ((select private.is_staff()) or client_visible)
  );

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
    )
  );

create policy documents_update on public.documents
  for update to authenticated
  using ((select private.has_role('admin', 'ops_manager', 'doc_officer')))
  with check (
    (select private.has_role('admin', 'ops_manager', 'doc_officer'))
    and (verification_status = 'pending' or verified_by = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- document_requirements: visible with the shipment; managed by doc staff
-- ---------------------------------------------------------------------------
grant select on public.document_requirements to authenticated;
grant insert (shipment_id, document_type, is_required, status, client_note, due_date)
  on public.document_requirements to authenticated;
grant update (is_required, status, client_note, due_date)
  on public.document_requirements to authenticated;

create policy document_requirements_select on public.document_requirements
  for select to authenticated
  using ((select private.can_access_shipment(shipment_id)));

create policy document_requirements_insert on public.document_requirements
  for insert to authenticated
  with check ((select private.has_role('admin', 'ops_manager', 'doc_officer')));

create policy document_requirements_update on public.document_requirements
  for update to authenticated
  using ((select private.has_role('admin', 'ops_manager', 'doc_officer')))
  with check ((select private.has_role('admin', 'ops_manager', 'doc_officer')));

-- ---------------------------------------------------------------------------
-- audit_log: read-only for admin and operations manager. Inserts come only
-- from the SECURITY DEFINER audit trigger.
-- ---------------------------------------------------------------------------
grant select on public.audit_log to authenticated;

create policy audit_log_select on public.audit_log
  for select to authenticated
  using ((select private.has_role('admin', 'ops_manager')));

-- ---------------------------------------------------------------------------
-- Storage: 'shipment-documents' bucket (private)
--   Path: {client_id}/{shipment_id}/{document_id}/{file_name}
--   read:   only if a documents row for this exact path is visible to the
--           caller (same rules as the documents table). Downloads use
--           short-lived signed URLs created server-side as the user.
--   upload: the caller may upload into a shipment folder they can upload
--           documents for, and the client folder must match the shipment.
--   update/delete: not allowed (no policy).
-- ---------------------------------------------------------------------------
create policy shipment_documents_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'shipment-documents'
    and exists (
      select 1 from public.documents d
      where d.storage_path = storage.objects.name
    )
  );

create policy shipment_documents_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'shipment-documents'
    and (select private.has_role('admin', 'ops_manager', 'doc_officer',
                                 'clearing_agent', 'driver'))
    and private.can_access_shipment(private.try_uuid((storage.foldername(name))[2]))
    and exists (
      select 1 from public.shipments s
      where s.id = private.try_uuid((storage.foldername(name))[2])
        and s.client_id = private.try_uuid((storage.foldername(name))[1])
    )
  );
