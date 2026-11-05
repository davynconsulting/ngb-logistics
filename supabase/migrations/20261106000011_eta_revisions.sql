-- ============================================================================
-- 0011 · ETA revisions (FRS §3 step 10, §7 notification rules, AC-09)
--   • current_eta on shipments changes ONLY through revise_eta(), which keeps
--     every previous value in the append-only eta_revisions table.
--   • Each revision needs a reason. Whether it is "material" (worth notifying
--     the client) is decided in the database from configurable thresholds:
--     more than 2 h when the delivery is due within 24 h, otherwise more than
--     6 h (FRS §7 proposed default). The first ETA is always material.
-- ============================================================================

create type public.eta_reason_category as enum (
  'vessel_delay', 'port_congestion', 'documents', 'customs', 'truck_availability',
  'road_conditions', 'border_delay', 'weather', 'client_request', 'schedule_confirmed', 'other'
);

-- Operational settings (single row per key; only admins change them, audited)
create table public.app_settings (
  key         text primary key check (key ~ '^[a-z0-9_.]+$'),
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) default auth.uid()
);

insert into public.app_settings (key, value, description) values
  ('eta.material_hours_same_day', '2', 'ETA change (hours) that counts as material when delivery is due within 24 hours'),
  ('eta.material_hours_other', '6', 'ETA change (hours) that counts as material otherwise');

create trigger audit_app_settings after insert or update or delete on public.app_settings
  for each row execute function private.audit_row();

alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to authenticated;
grant update (value, updated_at, updated_by) on public.app_settings to authenticated;

create policy app_settings_select on public.app_settings
  for select to authenticated using ((select private.is_staff()));
create policy app_settings_update on public.app_settings
  for update to authenticated
  using ((select private.has_role('admin'))) with check ((select private.has_role('admin')));

create or replace function private.setting_numeric(p_key text, p_default numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value #>> '{}')::numeric from public.app_settings s where s.key = p_key), p_default)
$$;

-- ---------------------------------------------------------------------------
-- eta_revisions (append-only, like milestone_events)
-- ---------------------------------------------------------------------------
create table public.eta_revisions (
  id                  uuid primary key default gen_random_uuid(),
  shipment_id         uuid not null references public.shipments (id) on delete restrict,
  previous_eta        timestamptz,
  new_eta             timestamptz not null,
  change_minutes      integer,                 -- new − previous (positive = later)
  reason_category     public.eta_reason_category not null,
  reason              text not null check (length(reason) between 3 and 500),
  is_material         boolean not null,
  threshold_hours     numeric not null,
  client_visible      boolean not null default true,
  notification_state  public.notification_state not null,
  revised_by          uuid references public.profiles (id) default auth.uid(),
  revised_at          timestamptz not null default now()
);
create index eta_revisions_shipment_idx on public.eta_revisions (shipment_id, revised_at desc);

create or replace function private.eta_revisions_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     or (to_jsonb(old) - 'notification_state') is distinct from (to_jsonb(new) - 'notification_state') then
    raise exception 'eta_revisions is append-only: % is not allowed', tg_op
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger eta_revisions_append_only
  before update or delete on public.eta_revisions
  for each row execute function private.eta_revisions_append_only();

alter table public.eta_revisions enable row level security;
revoke all on public.eta_revisions from anon, authenticated;
grant select on public.eta_revisions to authenticated;

-- staff with access; clients only client-visible revisions of their own shipments
create policy eta_revisions_select on public.eta_revisions
  for select to authenticated
  using ((select private.can_access_shipment(shipment_id))
         and ((select private.is_staff()) or client_visible));

-- ---------------------------------------------------------------------------
-- revise_eta: SECURITY DEFINER because users cannot write current_eta.
-- The role and access checks below are the security boundary.
-- ---------------------------------------------------------------------------
create or replace function public.revise_eta(
  p_shipment_id     uuid,
  p_new_eta         timestamptz,
  p_reason_category public.eta_reason_category,
  p_reason          text,
  p_client_visible  boolean default true
)
returns table (revision_id uuid, material boolean, minutes_changed integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role      public.app_role := private.current_app_role();
  s           public.shipments;
  v_reason    text := nullif(trim(p_reason), '');
  v_change    integer;
  v_threshold numeric;
  v_material  boolean;
  v_visible   boolean := coalesce(p_client_visible, true);
  v_id        uuid;
begin
  if v_role is null or v_role not in ('admin', 'ops_manager', 'doc_officer', 'clearing_agent', 'transport_coord') then
    raise exception 'You are not allowed to change the ETA' using errcode = '42501';
  end if;
  if not private.can_access_shipment(p_shipment_id) then
    raise exception 'Shipment not found' using errcode = 'P0002';
  end if;

  select * into s from public.shipments sh where sh.id = p_shipment_id for update;
  if not found then
    raise exception 'Shipment not found' using errcode = 'P0002';
  end if;
  if s.overall_status in ('delivered', 'container_returned', 'operationally_complete', 'closed') then
    raise exception 'The shipment is already delivered' using errcode = '55000';
  end if;
  if p_new_eta is null or p_new_eta < now() - interval '1 hour' then
    raise exception 'The new ETA cannot be in the past' using errcode = '22023';
  end if;
  if p_new_eta > now() + interval '180 days' then
    raise exception 'The new ETA is too far ahead' using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'Give a reason for the ETA change' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'The reason is too long' using errcode = '22023';
  end if;
  if s.current_eta is not null and s.current_eta = p_new_eta then
    raise exception 'The ETA is unchanged' using errcode = '22023';
  end if;

  v_change := case when s.current_eta is null then null
                   else round(extract(epoch from (p_new_eta - s.current_eta)) / 60)::integer end;
  -- "same-day" = the delivery was due within the next 24 hours
  v_threshold := case when s.current_eta is not null and s.current_eta <= now() + interval '24 hours'
                      then private.setting_numeric('eta.material_hours_same_day', 2)
                      else private.setting_numeric('eta.material_hours_other', 6) end;
  v_material := s.current_eta is null or abs(v_change) > v_threshold * 60;

  insert into public.eta_revisions (shipment_id, previous_eta, new_eta, change_minutes, reason_category, reason,
                                    is_material, threshold_hours, client_visible, notification_state)
  values (p_shipment_id, s.current_eta, p_new_eta, v_change, p_reason_category, v_reason,
          v_material, v_threshold, v_visible,
          case when v_material and v_visible then 'pending' else 'suppressed' end::public.notification_state)
  returning id into v_id;

  update public.shipments sh
     set current_eta = p_new_eta, eta_updated_at = now(), eta_reason = v_reason
   where sh.id = p_shipment_id;

  return query select v_id, v_material, v_change;
end;
$$;

revoke all on function public.revise_eta(uuid, timestamptz, public.eta_reason_category, text, boolean) from public, anon;
grant execute on function public.revise_eta(uuid, timestamptz, public.eta_reason_category, text, boolean) to authenticated;
revoke all on function private.setting_numeric(text, numeric) from public, anon, authenticated;
revoke all on function private.eta_revisions_append_only() from public, anon, authenticated;
