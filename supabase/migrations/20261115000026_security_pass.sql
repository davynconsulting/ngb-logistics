-- 0026: fixes from the Sprint 5 security pass (tests/live/security.mjs)
--
-- 1. Clearing agents only see the client companies (and those companies' users) of the shipments
--    assigned to them. Before, being "office staff" let them read every client: tax IDs, credit
--    limits, billing addresses, phone numbers and e-mails of all client users. Their shipment
--    access was already limited to assignments (can_access_shipment); this brings organizations
--    and profiles in line. Other office roles are unchanged.
-- 2. Return deadline and depot cannot be set by a direct container INSERT either (0024 revoked
--    UPDATE); they change only through set_container_return_terms, which validates them.
-- 3. public.rls_auto_enable(), added to hosted projects by the Supabase platform (an event-trigger
--    function), was executable by anyone through the API. It cannot run as a plain call, but
--    nothing should call it: execute is revoked when the function exists and we may change it.

-- ---------------------------------------------------------------------------
-- 1. Clearing agents: assigned clients only
-- ---------------------------------------------------------------------------
-- An organization the current user may see (SECURITY DEFINER: reads assignments without RLS recursion)
create or replace function private.can_see_organization(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.current_app_role() is null then false
    when private.current_app_role() = 'clearing_agent' then
      exists (select 1 from public.organizations o where o.id = p_org_id and o.is_internal)
      or exists (select 1 from public.shipment_assignments a join public.shipments s on s.id = a.shipment_id
                  where a.user_id = auth.uid() and s.client_id = p_org_id)
    when private.is_office_staff() then true
    else p_org_id = private.current_org_id()
  end
$$;

drop policy organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated
  using ((select private.can_see_organization(id)));

drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    -- office staff other than clearing agents: everyone
    or ((select private.is_office_staff()) and (select private.current_app_role()) <> 'clearing_agent')
    -- clearing agents: NGB staff, and users of the clients of their assigned shipments
    or ((select private.current_app_role()) = 'clearing_agent'
        and (role <> 'client' or (select private.can_see_organization(organization_id))))
    -- client users can see colleagues in their own organization
    or ((select private.current_app_role()) = 'client' and organization_id = (select private.current_org_id()))
  );

revoke all on function private.can_see_organization(uuid) from public, anon;
grant execute on function private.can_see_organization(uuid) to authenticated;   -- used inside RLS policies

-- ---------------------------------------------------------------------------
-- 2. Return terms only through the checked function
-- ---------------------------------------------------------------------------
revoke insert (return_deadline, return_depot) on public.containers from authenticated;

-- ---------------------------------------------------------------------------
-- 3. Platform helper not callable through the API
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    begin
      execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
    exception when insufficient_privilege then
      raise notice 'rls_auto_enable is owned by the platform; execute left unchanged';
    end;
  end if;
end;
$$;
