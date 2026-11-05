-- ============================================================================
-- 0008 · Atomic shipment registration, duplicate protection, profile emails
-- FRS §3 step 02 (shipment registration), AC-01 (unique references, duplicates
-- rejected), AC-02 (multiple containers per shipment)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A bill of lading identifies one shipment: never register it twice.
-- (Case-insensitive; shipments without a BL yet are allowed.)
-- ---------------------------------------------------------------------------
drop index if exists public.shipments_bl_number_idx;
create unique index shipments_bl_number_unique
  on public.shipments (upper(trim(bl_number)))
  where bl_number is not null;

-- ---------------------------------------------------------------------------
-- Is this container already on a shipment that is not closed?
-- SECURITY DEFINER so the answer is complete whatever the caller can see;
-- it returns only true/false.
-- ---------------------------------------------------------------------------
create or replace function private.container_on_open_shipment(p_container_number text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.containers c
    join public.shipments s on s.id = c.shipment_id
    where c.container_number = upper(p_container_number)
      and s.overall_status <> 'closed'
  )
$$;

revoke all on function private.container_on_open_shipment(text) from public, anon;
grant execute on function private.container_on_open_shipment(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- register_shipment: shipment + containers + document checklist in ONE
-- transaction (all or nothing).
--
-- SECURITY INVOKER: runs as the signed-in user, so RLS policies and column
-- privileges apply exactly as for direct inserts. Status columns cannot be
-- set: new shipments always start as 'draft'.
-- ---------------------------------------------------------------------------
create or replace function public.register_shipment(
  p_shipment   jsonb,
  p_containers jsonb,
  p_required_documents public.document_type[] default
    array['bill_of_lading', 'commercial_invoice', 'packing_list']::public.document_type[]
)
returns table (shipment_id uuid, shipment_reference text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id       uuid;
  v_ref      text;
  v_numbers  text[];
  v_dup      text;
begin
  if not private.has_role('admin', 'ops_manager', 'doc_officer') then
    raise exception 'You are not allowed to register shipments' using errcode = '42501';
  end if;

  if p_containers is null or jsonb_typeof(p_containers) <> 'array'
     or jsonb_array_length(p_containers) = 0 then
    raise exception 'Add at least one container' using errcode = '22023';
  end if;

  select array_agg(upper(trim(x ->> 'container_number')))
    into v_numbers
    from jsonb_array_elements(p_containers) x;

  -- Same container twice in this registration
  select n into v_dup from unnest(v_numbers) n group by n having count(*) > 1 limit 1;
  if v_dup is not null then
    raise exception 'Container % is listed twice', v_dup using errcode = '23505';
  end if;

  -- Container still active on another shipment
  select n into v_dup from unnest(v_numbers) n
   where private.container_on_open_shipment(n) limit 1;
  if v_dup is not null then
    raise exception 'Container % is already on an open shipment', v_dup using errcode = '23505';
  end if;

  insert into public.shipments (
    client_id, booking_reference, bl_number, shipping_line, vessel_name, voyage_number,
    origin_port_id, origin_terminal, destination_country, destination_city,
    delivery_address, cargo_description, package_count, gross_weight_kg,
    planned_vessel_arrival, assigned_ops_user_id
  ) values (
    (p_shipment ->> 'client_id')::uuid,
    nullif(trim(p_shipment ->> 'booking_reference'), ''),
    nullif(upper(trim(p_shipment ->> 'bl_number')), ''),
    nullif(trim(p_shipment ->> 'shipping_line'), ''),
    nullif(trim(p_shipment ->> 'vessel_name'), ''),
    nullif(upper(trim(p_shipment ->> 'voyage_number')), ''),
    (p_shipment ->> 'origin_port_id')::uuid,
    nullif(trim(p_shipment ->> 'origin_terminal'), ''),
    upper(p_shipment ->> 'destination_country'),
    trim(p_shipment ->> 'destination_city'),
    nullif(trim(p_shipment ->> 'delivery_address'), ''),
    nullif(trim(p_shipment ->> 'cargo_description'), ''),
    nullif(p_shipment ->> 'package_count', '')::integer,
    nullif(p_shipment ->> 'gross_weight_kg', '')::numeric,
    nullif(p_shipment ->> 'planned_vessel_arrival', '')::timestamptz,
    coalesce(nullif(p_shipment ->> 'assigned_ops_user_id', '')::uuid, auth.uid())
  )
  returning id, public.shipments.shipment_reference into v_id, v_ref;

  insert into public.containers (shipment_id, container_number, size_type, seal_number)
  select v_id,
         upper(trim(x ->> 'container_number')),
         nullif(x ->> 'size_type', ''),
         nullif(upper(trim(x ->> 'seal_number')), '')
    from jsonb_array_elements(p_containers) x;

  insert into public.document_requirements (shipment_id, document_type)
  select v_id, d from unnest(coalesce(p_required_documents, '{}')) d
  on conflict do nothing;

  return query select v_id, v_ref;
end;
$$;

revoke all on function public.register_shipment(jsonb, jsonb, public.document_type[]) from public, anon;
grant execute on function public.register_shipment(jsonb, jsonb, public.document_type[]) to authenticated;

-- ---------------------------------------------------------------------------
-- profiles.email: shown in the admin user list; kept in sync with auth.users
-- ---------------------------------------------------------------------------
alter table public.profiles add column email text;

update public.profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id;

create or replace function private.sync_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role  public.app_role;
  v_org   uuid;
begin
  begin
    v_role := nullif(new.raw_app_meta_data ->> 'role', '')::public.app_role;
    v_org  := nullif(new.raw_app_meta_data ->> 'organization_id', '')::uuid;
  exception when others then
    raise exception 'Invalid role or organization in app metadata';
  end;

  if v_role is null and v_org is null then
    return new;
  end if;

  if v_role is null or v_org is null then
    raise exception 'Role and organization must both be set in app metadata';
  end if;

  if not exists (select 1 from public.profiles p where p.id = new.id) then
    insert into public.profiles (id, organization_id, role, full_name, phone_e164, email)
    values (
      new.id,
      v_org,
      v_role,
      coalesce(new.raw_app_meta_data ->> 'full_name', ''),
      nullif(new.raw_app_meta_data ->> 'phone_e164', ''),
      new.email
    );

    insert into public.notification_preferences (user_id, locale)
    select new.id, o.preferred_language
    from public.organizations o
    where o.id = v_org
    on conflict (user_id) do nothing;
  else
    update public.profiles
       set role = v_role,
           organization_id = v_org
     where id = new.id
       and (role is distinct from v_role or organization_id is distinct from v_org);
  end if;

  return new;
end;
$$;

create or replace function private.sync_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

revoke all on function private.sync_user_email() from public, anon;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (new.email is distinct from old.email)
  execute function private.sync_user_email();
