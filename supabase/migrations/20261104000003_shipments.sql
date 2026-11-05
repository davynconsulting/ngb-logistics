-- ============================================================================
-- 0003 · Ports, shipments, containers, shipment assignments
-- FRS §6.2 (shipment), §6.3 (container), §2 (assigned-only roles)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ISO 6346 container number check (mirrors lib/domain/container-number.ts)
-- Letter values: A=10 … skipping multiples of 11  →  base + (base - 1) / 10
-- ---------------------------------------------------------------------------
create or replace function private.is_valid_container_number(cn text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  total integer := 0;
  ch    text;
  base  integer;
  val   integer;
begin
  if cn is null or cn !~ '^[A-Z]{3}[UJZ][0-9]{7}$' then
    return false;
  end if;
  for i in 1..10 loop
    ch := substr(cn, i, 1);
    if i <= 4 then
      base := ascii(ch) - 55;               -- 'A' (65) → 10
      val  := base + (base - 1) / 10;       -- skip 11, 22, 33
    else
      val := ch::integer;
    end if;
    total := total + val * (2 ^ (i - 1))::integer;
  end loop;
  return (total % 11) % 10 = substr(cn, 11, 1)::integer;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shipment references: NGB-YYYY-NNNNN, gap-tolerant, concurrency-safe
-- ---------------------------------------------------------------------------
create table private.shipment_reference_counters (
  year        integer primary key,
  last_value  integer not null
);

create or replace function private.next_shipment_reference()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year  integer := extract(year from (now() at time zone 'Africa/Kigali'))::integer;
  v_next  integer;
begin
  insert into private.shipment_reference_counters as c (year, last_value)
  values (v_year, 1)
  on conflict (year) do update set last_value = c.last_value + 1
  returning c.last_value into v_next;

  return format('NGB-%s-%s', v_year, lpad(v_next::text, 5, '0'));
end;
$$;

-- ---------------------------------------------------------------------------
-- ports (configuration: no assumption of a single port, FRS §11 scalability)
-- ---------------------------------------------------------------------------
create table public.ports (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z]{5}$'),  -- UN/LOCODE
  name        text not null,
  country     char(2) not null check (country ~ '^[A-Z]{2}$'),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Reference data (real public port codes; not test data)
insert into public.ports (code, name, country) values
  ('TZDAR', 'Dar es Salaam', 'TZ'),
  ('KEMBA', 'Mombasa', 'KE');

-- ---------------------------------------------------------------------------
-- shipments (FRS §6.2)
-- ---------------------------------------------------------------------------
create table public.shipments (
  id                      uuid primary key default gen_random_uuid(),
  shipment_reference      text not null unique
                            default private.next_shipment_reference()
                            check (shipment_reference ~ '^NGB-[0-9]{4}-[0-9]{5,}$'),
  client_id               uuid not null references public.organizations (id),
  booking_reference       text,
  bl_number               text,
  shipping_line           text,
  vessel_name             text,
  voyage_number           text,
  origin_port_id          uuid not null references public.ports (id),
  origin_terminal         text,
  destination_country     char(2) not null check (destination_country ~ '^[A-Z]{2}$'),
  destination_city        text not null check (length(trim(destination_city)) > 0),
  delivery_address        text,
  cargo_description       text,
  package_count           integer check (package_count >= 0),
  gross_weight_kg         numeric(12,2) check (gross_weight_kg >= 0),
  planned_vessel_arrival  timestamptz,
  actual_vessel_arrival   timestamptz,

  -- Status tracks (FRS §4). Changed only by controlled RPC functions (Sprint 2);
  -- direct UPDATE of these columns is not granted to users (see 0006).
  overall_status          public.shipment_status  not null default 'draft',
  doc_status              public.doc_status       not null default 'missing',
  customs_status          public.customs_status   not null default 'not_started',
  transport_status        public.transport_status not null default 'unassigned',
  delivery_status         public.delivery_status  not null default 'pending',
  return_status           public.return_status    not null default 'not_due',
  finance_status          public.finance_status   not null default 'not_invoiced',
  has_open_exception      boolean not null default false,

  current_eta             timestamptz,
  eta_updated_at          timestamptz,
  eta_reason              text,

  assigned_ops_user_id    uuid not null default auth.uid() references public.profiles (id),
  created_by              uuid default auth.uid() references public.profiles (id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  closed_at               timestamptz,

  constraint eta_change_has_reason check (
    eta_updated_at is null or eta_reason is not null
  ),
  constraint closed_at_matches_status check (
    (overall_status = 'closed') = (closed_at is not null)
  )
);

create index shipments_client_id_idx      on public.shipments (client_id);
create index shipments_overall_status_idx on public.shipments (overall_status);
create index shipments_assigned_ops_idx   on public.shipments (assigned_ops_user_id);
create index shipments_bl_number_idx      on public.shipments (bl_number) where bl_number is not null;

create trigger shipments_updated_at
  before update on public.shipments
  for each row execute function private.set_updated_at();

-- Shipment owner must be a client org; responsible user must be NGB staff
create or replace function private.check_shipment_parties()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.organizations o
             where o.id = new.client_id and o.is_internal) then
    raise exception 'Shipments must belong to a client organization';
  end if;
  if not exists (select 1 from public.profiles p
                 where p.id = new.assigned_ops_user_id
                   and p.role <> 'client' and p.is_active) then
    raise exception 'Responsible user must be active NGB staff';
  end if;
  return new;
end;
$$;

create trigger shipments_parties_check
  before insert or update of client_id, assigned_ops_user_id on public.shipments
  for each row execute function private.check_shipment_parties();

-- ---------------------------------------------------------------------------
-- containers (FRS §6.3): one shipment → many containers (AC-02)
-- ---------------------------------------------------------------------------
create table public.containers (
  id                  uuid primary key default gen_random_uuid(),
  shipment_id         uuid not null references public.shipments (id) on delete restrict,
  container_number    text not null
                        check (private.is_valid_container_number(container_number)),
  size_type           text check (size_type in (
                        '20GP', '40GP', '40HC', '45HC', '20RF', '40RF',
                        '20OT', '40OT', '20FR', '40FR', '20TK', 'OTHER')),
  seal_number         text,
  location_kind       public.location_kind,
  location_name       text,
  operational_status  public.shipment_status not null default 'registered',
  delivery_status     public.delivery_status not null default 'pending',
  return_status       public.return_status   not null default 'not_due',
  discharge_at        timestamptz,
  gate_out_at         timestamptz,
  delivery_at         timestamptz,
  empty_return_at     timestamptz,
  condition           text,
  return_depot        text,
  return_deadline     timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (shipment_id, container_number)
);

create index containers_shipment_id_idx on public.containers (shipment_id);
create index containers_number_idx      on public.containers (container_number);

create trigger containers_updated_at
  before update on public.containers
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- shipment_assignments: gives clearing agents and drivers access to specific
-- shipments only (FRS §2). Other staff roles see all shipments.
-- ---------------------------------------------------------------------------
create table public.shipment_assignments (
  shipment_id  uuid not null references public.shipments (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  assigned_by  uuid default auth.uid() references public.profiles (id),
  assigned_at  timestamptz not null default now(),
  primary key (shipment_id, user_id)
);

create index shipment_assignments_user_idx on public.shipment_assignments (user_id);

-- Only clearing agents and drivers are assigned this way
create or replace function private.check_assignment_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p
                 where p.id = new.user_id
                   and p.role in ('clearing_agent', 'driver')) then
    raise exception 'Only clearing agents and drivers are assigned to individual shipments';
  end if;
  return new;
end;
$$;

create trigger shipment_assignments_role_check
  before insert or update on public.shipment_assignments
  for each row execute function private.check_assignment_role();
