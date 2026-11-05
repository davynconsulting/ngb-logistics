-- ============================================================================
-- 0007 · Fix: create/sync profiles from app metadata on INSERT *or* UPDATE
--
-- Why: Supabase Auth's admin createUser() inserts the auth.users row first and
-- writes app_metadata (role, organization_id) in a follow-up UPDATE within the
-- same transaction. The 0002 trigger ran only on INSERT, saw no role yet and
-- rejected every user.
--
-- New behaviour:
--   • role + organization present        → create the profile (once) and keep
--                                           role/organization in sync afterwards
--   • neither present                    → no profile, therefore NO access
--                                           (every RLS rule requires an active profile)
--   • only one present, or invalid value → rejected (transaction rolls back)
--
-- app_metadata can only be written with the service role, never by the user.
-- ============================================================================

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists private.handle_new_user();

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

  -- Not yet assigned: no profile, no access
  if v_role is null and v_org is null then
    return new;
  end if;

  if v_role is null or v_org is null then
    raise exception 'Role and organization must both be set in app metadata';
  end if;

  if not exists (select 1 from public.profiles p where p.id = new.id) then
    insert into public.profiles (id, organization_id, role, full_name, phone_e164)
    values (
      new.id,
      v_org,
      v_role,
      coalesce(new.raw_app_meta_data ->> 'full_name', ''),
      nullif(new.raw_app_meta_data ->> 'phone_e164', '')
    );

    insert into public.notification_preferences (user_id, locale)
    select new.id, o.preferred_language
    from public.organizations o
    where o.id = v_org
    on conflict (user_id) do nothing;
  else
    -- Admin changed role/organization: keep the profile in sync (audited)
    update public.profiles
       set role = v_role,
           organization_id = v_org
     where id = new.id
       and (role is distinct from v_role or organization_id is distinct from v_org);
  end if;

  return new;
end;
$$;

revoke all on function private.sync_user_profile() from public, anon;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.sync_user_profile();

create trigger on_auth_user_app_metadata_changed
  after update of raw_app_meta_data on auth.users
  for each row
  when (new.raw_app_meta_data is distinct from old.raw_app_meta_data)
  execute function private.sync_user_profile();
