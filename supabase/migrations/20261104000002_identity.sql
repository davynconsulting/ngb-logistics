-- ============================================================================
-- 0002 · Identity & tenancy: organizations, profiles, notification preferences
-- FRS §6.1 (client/organization), §6.8 (user account), §7.1 (consent)
-- ============================================================================

-- Shared trigger: keep updated_at current
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- organizations: NGB itself (is_internal = true, exactly one) + each client
-- ---------------------------------------------------------------------------
create table public.organizations (
  id                    uuid primary key default gen_random_uuid(),
  client_code           text not null unique
                          check (client_code ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
  legal_name            text not null check (length(trim(legal_name)) > 0),
  is_internal           boolean not null default false,
  primary_contact_name  text,
  phone_e164            text check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  email                 text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  billing_address       text,
  tax_id                text,
  preferred_language    text not null default 'en'
                          check (preferred_language in ('en', 'fr', 'rw', 'sw')),
  timezone              text not null default 'Africa/Kigali',
  billing_terms_days    integer check (billing_terms_days between 0 and 365),
  credit_limit          numeric(14,2) check (credit_limit >= 0),
  credit_currency       char(3) check (credit_currency in ('USD', 'TZS', 'KES', 'RWF')),
  account_manager_id    uuid,              -- FK added after profiles exists
  -- FRS §7: expose driver contact details only under company policy
  show_driver_contact   boolean not null default false,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- FRS §6.1: client organizations need a primary contact and phone
  constraint client_contact_required check (
    is_internal or (primary_contact_name is not null and phone_e164 is not null)
  ),
  constraint credit_limit_has_currency check (
    credit_limit is null or credit_currency is not null
  )
);

comment on table public.organizations is
  'NGB LOGISTICS (is_internal) and client organizations. Clients see only their own row.';

-- Only one internal (NGB) organization may exist
create unique index organizations_single_internal
  on public.organizations (is_internal) where is_internal;

create trigger organizations_updated_at
  before update on public.organizations
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- profiles: one per auth user; holds organization + role
-- ---------------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id),
  role             public.app_role not null,
  full_name        text not null default '',
  phone_e164       text check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  is_active        boolean not null default true,
  last_login_at    timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.profiles is
  'Application identity. role + organization_id drive every RLS decision.';

create index profiles_organization_id_idx on public.profiles (organization_id);

alter table public.organizations
  add constraint organizations_account_manager_fk
  foreign key (account_manager_id) references public.profiles (id) on delete set null;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- Role/organization consistency: clients belong to client orgs, staff to NGB.
create or replace function private.check_profile_role_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_internal boolean;
begin
  select o.is_internal into org_internal
  from public.organizations o
  where o.id = new.organization_id;

  if new.role = 'client' and org_internal then
    raise exception 'Client users must belong to a client organization';
  elsif new.role <> 'client' and not org_internal then
    raise exception 'Staff users must belong to the NGB organization';
  end if;
  return new;
end;
$$;

create trigger profiles_role_org_check
  before insert or update of role, organization_id on public.profiles
  for each row execute function private.check_profile_role_org();

-- Account managers must be active NGB staff
create or replace function private.check_account_manager()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.account_manager_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = new.account_manager_id and p.role <> 'client'
  ) then
    raise exception 'Account manager must be an NGB staff member';
  end if;
  return new;
end;
$$;

create trigger organizations_account_manager_check
  before insert or update of account_manager_id on public.organizations
  for each row execute function private.check_account_manager();

-- ---------------------------------------------------------------------------
-- notification_preferences (FRS §6.1, §7.1: opt-in + consent record)
-- ---------------------------------------------------------------------------
create table public.notification_preferences (
  user_id          uuid primary key references public.profiles (id) on delete cascade,
  push_enabled     boolean not null default true,
  whatsapp_opt_in  boolean not null default false,
  whatsapp_phone   text check (whatsapp_phone ~ '^\+[1-9][0-9]{6,14}$'),
  consent_at       timestamptz,
  consent_source   text,
  locale           text not null default 'en' check (locale in ('en', 'fr', 'rw', 'sw')),
  updated_at       timestamptz not null default now(),

  -- WhatsApp opt-in is only valid with a phone number and a consent record
  constraint whatsapp_consent_recorded check (
    not whatsapp_opt_in
    or (whatsapp_phone is not null and consent_at is not null and consent_source is not null)
  )
);

create trigger notification_preferences_updated_at
  before update on public.notification_preferences
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- New auth user → profile + preferences.
--
-- SECURITY: role and organization are read from raw_APP_meta_data, which only
-- the service role (NGB admin console) can set. raw_USER_meta_data is
-- user-editable and is never trusted for authorization.
-- Users created without an assigned role/organization are rejected.
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user()
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
    v_role := (new.raw_app_meta_data ->> 'role')::public.app_role;
    v_org  := (new.raw_app_meta_data ->> 'organization_id')::uuid;
  exception when others then
    raise exception 'Invalid role or organization in app metadata';
  end;

  if v_role is null or v_org is null then
    raise exception 'Users must be created through the NGB admin console (role and organization required)';
  end if;

  insert into public.profiles (id, organization_id, role, full_name, phone_e164)
  values (
    new.id,
    v_org,
    v_role,
    coalesce(new.raw_app_meta_data ->> 'full_name', ''),
    new.raw_app_meta_data ->> 'phone_e164'
  );

  insert into public.notification_preferences (user_id, locale)
  select new.id, o.preferred_language
  from public.organizations o
  where o.id = v_org;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Record last login time on the profile
create or replace function private.handle_user_login()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set last_login_at = new.last_sign_in_at
   where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_login
  after update of last_sign_in_at on auth.users
  for each row
  when (new.last_sign_in_at is distinct from old.last_sign_in_at)
  execute function private.handle_user_login();
