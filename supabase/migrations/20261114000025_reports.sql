-- 0025: management reports (FRS §10 internal dashboard, US-12): port dwell time, transit duration,
-- delivery performance and overdue invoices.
--
-- * Read-only functions; nothing here changes data.
-- * Operational reports: admin and operations managers. Overdue invoices: finance readers
--   (finance, admin, ops_manager). Everyone else is refused (42501); clients never see them.
-- * Measured per container, on completed legs only, over a period of at most 366 days:
--     dwell    = discharge → gate-out, against port processing + dispatch SLA estimates
--     transit  = gate-out → delivery, against the route's transit estimate (72 h without a route)
--     on time  = delivered by the ETA in force when the container left the port, plus the
--                material-ETA tolerance ('eta.material_hours_other', default 6 h)
--     returns  = empty returned by its return deadline
-- * Money: sums of numeric(14,2), returned as numeric(14,2) (exact; shown as decimal strings).

create index if not exists containers_gate_out_idx on public.containers (gate_out_at) where gate_out_at is not null;
create index if not exists containers_delivery_idx on public.containers (delivery_at) where delivery_at is not null;
create index if not exists containers_empty_return_idx on public.containers (empty_return_at) where empty_return_at is not null;

create or replace function private.report_guard(p_roles public.app_role[], p_from timestamptz, p_to timestamptz)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.current_app_role() is null or not (private.current_app_role() = any (p_roles)) then
    raise exception 'You are not allowed to view this report' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '366 days' then
    raise exception 'Choose a period of up to one year' using errcode = '22023';
  end if;
end;
$$;

-- Route of a container: its latest active transport assignment
create or replace function private.container_route(p_container_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.route_id from public.transport_assignments a
    join public.transport_assignment_containers ac on ac.assignment_id = a.id
   where ac.container_id = p_container_id and a.status = 'active'
   order by a.assigned_at desc limit 1
$$;

-- ---------------------------------------------------------------------------
-- Port dwell time (containers that gated out in the period)
-- ---------------------------------------------------------------------------
create or replace function public.report_port_dwell(p_from timestamptz, p_to timestamptz)
returns table (port_code text, port_name text, containers integer, avg_hours numeric, median_hours numeric,
               p90_hours numeric, max_hours numeric, estimate_hours integer, within_estimate integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.report_guard('{admin,ops_manager}', p_from, p_to);
  return query
  with d as (
    select p.code, p.name,
           extract(epoch from (c.gate_out_at - c.discharge_at)) / 3600.0 as hours,
           coalesce((private.sla_rule('port_processing', p.id, null)).threshold_hours, 96)
             + coalesce((private.sla_rule('dispatch', p.id, null)).threshold_hours, 24) as estimate
      from public.containers c
      join public.shipments s on s.id = c.shipment_id
      join public.ports p on p.id = s.origin_port_id
     where c.gate_out_at >= p_from and c.gate_out_at < p_to
       and c.discharge_at is not null and c.gate_out_at >= c.discharge_at
       and s.overall_status <> 'draft'
  )
  select d.code, d.name, count(*)::integer,
         round(avg(d.hours)::numeric, 1),
         round((percentile_cont(0.5) within group (order by d.hours))::numeric, 1),
         round((percentile_cont(0.9) within group (order by d.hours))::numeric, 1),
         round(max(d.hours)::numeric, 1),
         max(d.estimate)::integer,
         (count(*) filter (where d.hours <= d.estimate))::integer
    from d group by d.code, d.name
   order by count(*) desc, d.code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Transit duration (containers delivered in the period)
-- ---------------------------------------------------------------------------
create or replace function public.report_transit(p_from timestamptz, p_to timestamptz)
returns table (route_code text, route_name text, containers integer, avg_hours numeric, median_hours numeric,
               p90_hours numeric, max_hours numeric, estimate_hours integer, within_estimate integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.report_guard('{admin,ops_manager}', p_from, p_to);
  return query
  with d as (
    select r.code, r.name,
           extract(epoch from (c.delivery_at - c.gate_out_at)) / 3600.0 as hours,
           coalesce(r.transit_estimate_hours, 72) as estimate
      from public.containers c
      join public.shipments s on s.id = c.shipment_id
      left join public.routes r on r.id = private.container_route(c.id)
     where c.delivery_at >= p_from and c.delivery_at < p_to
       and c.gate_out_at is not null and c.delivery_at >= c.gate_out_at
       and s.overall_status <> 'draft'
  )
  select d.code, coalesce(d.name, 'No route recorded'), count(*)::integer,
         round(avg(d.hours)::numeric, 1),
         round((percentile_cont(0.5) within group (order by d.hours))::numeric, 1),
         round((percentile_cont(0.9) within group (order by d.hours))::numeric, 1),
         round(max(d.hours)::numeric, 1),
         max(d.estimate)::integer,
         (count(*) filter (where d.hours <= d.estimate))::integer
    from d group by d.code, d.name
   order by count(*) desc, d.code nulls last;
end;
$$;

-- ---------------------------------------------------------------------------
-- Delivery performance by client (delivered / returned in the period)
-- ---------------------------------------------------------------------------
-- ETA promised when the container left the port: the last revision made at or before gate-out;
-- else the ETA that the first later revision replaced; else the current ETA (never revised);
-- else gate-out + the route estimate.
create or replace function private.eta_at_dispatch(p_shipment_id uuid, p_gate_out timestamptz, p_container_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select e.new_eta from public.eta_revisions e
      where e.shipment_id = p_shipment_id and e.revised_at <= p_gate_out order by e.revised_at desc limit 1),
    (select e.previous_eta from public.eta_revisions e
      where e.shipment_id = p_shipment_id and e.revised_at > p_gate_out order by e.revised_at asc limit 1),
    (select s.current_eta from public.shipments s where s.id = p_shipment_id),
    p_gate_out + make_interval(hours => coalesce(
      (select r.transit_estimate_hours from public.routes r where r.id = private.container_route(p_container_id)), 72)))
$$;

create or replace function public.report_delivery_performance(p_from timestamptz, p_to timestamptz)
returns table (client_id uuid, client_name text, delivered integer, on_time integer, late integer,
               avg_late_hours numeric, returned integer, returned_on_time integer, return_overdue_now integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tolerance numeric := private.setting_numeric('eta.material_hours_other', 6);
begin
  perform private.report_guard('{admin,ops_manager}', p_from, p_to);
  return query
  with dl as (
    select s.client_id,
           extract(epoch from (c.delivery_at - private.eta_at_dispatch(s.id, c.gate_out_at, c.id))) / 3600.0 as late_by
      from public.containers c join public.shipments s on s.id = c.shipment_id
     where c.delivery_at >= p_from and c.delivery_at < p_to and c.gate_out_at is not null
       and s.overall_status <> 'draft'
  ),
  rt as (
    select s.client_id, (c.return_deadline is null or c.empty_return_at <= c.return_deadline) as in_time
      from public.containers c join public.shipments s on s.id = c.shipment_id
     where c.empty_return_at >= p_from and c.empty_return_at < p_to and s.overall_status <> 'draft'
  ),
  od as (
    select s.client_id, count(*)::integer as n
      from public.containers c join public.shipments s on s.id = c.shipment_id
     where c.return_status = 'return_overdue' and s.overall_status not in ('draft', 'closed')
     group by s.client_id
  ),
  clients as (
    select x.client_id from dl x union select x.client_id from rt x union select x.client_id from od x
  )
  select o.id, o.legal_name,
         (select count(*) from dl where dl.client_id = o.id)::integer,
         (select count(*) from dl where dl.client_id = o.id and dl.late_by <= v_tolerance)::integer,
         (select count(*) from dl where dl.client_id = o.id and dl.late_by > v_tolerance)::integer,
         (select round(avg(dl.late_by)::numeric, 1) from dl where dl.client_id = o.id and dl.late_by > v_tolerance),
         (select count(*) from rt where rt.client_id = o.id)::integer,
         (select count(*) from rt where rt.client_id = o.id and rt.in_time)::integer,
         coalesce((select od.n from od where od.client_id = o.id), 0)
    from clients k join public.organizations o on o.id = k.client_id
   order by 3 desc, o.legal_name;
end;
$$;

-- ---------------------------------------------------------------------------
-- Overdue invoices: ageing by client and currency (past due in the client's time zone)
-- ---------------------------------------------------------------------------
create or replace function public.report_overdue_invoices()
returns table (client_id uuid, client_name text, currency char(3), invoices integer, disputed integer,
               days_1_30 numeric, days_31_60 numeric, days_61_90 numeric, days_over_90 numeric,
               total_overdue numeric, oldest_due_date date)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(private.is_finance_reader(), false) then
    raise exception 'You are not allowed to view this report' using errcode = '42501';
  end if;
  return query
  with d as (
    select i.client_id, o.legal_name, i.currency, i.balance_due, i.due_date, i.status,
           (now() at time zone coalesce(o.timezone, 'Africa/Kigali'))::date - i.due_date as days
      from public.invoices i join public.organizations o on o.id = i.client_id
     where i.status in ('issued', 'partially_paid', 'overdue', 'disputed') and i.balance_due > 0
  )
  select d.client_id, d.legal_name, d.currency, count(*)::integer,
         (count(*) filter (where d.status = 'disputed'))::integer,
         coalesce(sum(d.balance_due) filter (where d.days between 1 and 30), 0)::numeric(14,2),
         coalesce(sum(d.balance_due) filter (where d.days between 31 and 60), 0)::numeric(14,2),
         coalesce(sum(d.balance_due) filter (where d.days between 61 and 90), 0)::numeric(14,2),
         coalesce(sum(d.balance_due) filter (where d.days > 90), 0)::numeric(14,2),
         sum(d.balance_due)::numeric(14,2),
         min(d.due_date)
    from d where d.days >= 1
   group by d.client_id, d.legal_name, d.currency
   order by sum(d.balance_due) desc, d.legal_name;
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
    'public.report_port_dwell(timestamptz, timestamptz)', 'public.report_transit(timestamptz, timestamptz)',
    'public.report_delivery_performance(timestamptz, timestamptz)', 'public.report_overdue_invoices()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'private.report_guard(public.app_role[], timestamptz, timestamptz)', 'private.container_route(uuid)',
    'private.eta_at_dispatch(uuid, timestamptz, uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;
