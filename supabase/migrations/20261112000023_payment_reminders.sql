-- 0023: payment reminders (AC-13), overdue refresh, finance alerts (FRS §7, §8, §9 rule 7)
--
-- * Stages are days relative to the due date (negative = before), from app_settings
--   'finance.reminder_stages' (default -3, 0, +7, +14, +30).
-- * Each (invoice, stage) is sent at most once: invoice_reminders has unique (invoice_id, stage)
--   and the notification event key is per invoice and stage (AC-13, FRS §7.1).
-- * Only the LATEST stage reached is sent; earlier ones that were missed (dispute, reminders
--   off, invoice issued late) are skipped, never sent in a burst.
-- * Never while disputed, never on the issue date itself, never when payments awaiting
--   verification already cover the balance, never for clients with reminders turned off.
-- * The daily job also moves invoices past their due date (client's time zone) to overdue.
-- * Finance users are alerted when an invoice becomes overdue and when a dispute is opened.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
alter table public.organizations add column payment_reminders boolean not null default true;
comment on column public.organizations.payment_reminders is 'Send payment reminders to this client (agreed client-specific setting)';
grant insert (payment_reminders), update (payment_reminders) on public.organizations to authenticated;

insert into public.app_settings (key, value, description) values
  ('finance.reminder_stages', '[-3, 0, 7, 14, 30]',
   'Payment reminder stages in days from the due date (negative = before). Each is sent once per invoice; never while disputed.');

-- Valid, sorted stages (ignores anything that is not a whole number between -60 and 365)
create or replace function private.reminder_stages()
returns integer[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select array_agg(distinct (x #>> '{}')::integer order by (x #>> '{}')::integer)
       from public.app_settings s, jsonb_array_elements(case when jsonb_typeof(s.value) = 'array' then s.value else '[]' end) x
      where s.key = 'finance.reminder_stages'
        and jsonb_typeof(x) = 'number' and (x #>> '{}') ~ '^-?\d{1,3}$'
        and (x #>> '{}')::integer between -60 and 365),
    '{-3,0,7,14,30}')
$$;

-- ---------------------------------------------------------------------------
-- Once-per-stage log (append-only)
-- ---------------------------------------------------------------------------
create table public.invoice_reminders (
  id             uuid primary key default gen_random_uuid(),
  invoice_id     uuid not null references public.invoices (id) on delete restrict,
  stage          integer not null check (stage between -60 and 365),
  days_from_due  integer not null,
  balance_due    numeric(14,2) not null check (balance_due > 0),
  currency       char(3) not null,
  sent_at        timestamptz not null default now(),
  unique (invoice_id, stage)
);
create trigger invoice_reminders_append_only before update or delete on public.invoice_reminders
  for each row execute function private.prevent_mutation();
create trigger audit_invoice_reminders after insert on public.invoice_reminders
  for each row execute function private.audit_row();

alter table public.invoice_reminders enable row level security;
revoke all on public.invoice_reminders from anon, authenticated;
grant select on public.invoice_reminders to authenticated;
create policy invoice_reminders_select on public.invoice_reminders for select to authenticated
  using ((select private.is_finance_reader()));

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
insert into public.notification_rules (template_key, audience, push, whatsapp, description) values
  ('invoice.reminder',        'client', true, true,  'Payment reminder: due soon, due today or overdue (once per stage)'),
  ('staff.invoice_overdue',   'staff',  true, false, 'An invoice became overdue (finance)'),
  ('staff.invoice_disputed',  'staff',  true, false, 'A client disputed an invoice (finance)');

create or replace function private.finance_recipients()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(p.id), '{}') from public.profiles p where p.role = 'finance' and p.is_active
$$;

-- Staff payloads may name the client and link to the admin invoice
create or replace function private.invoice_staff_payload(p_invoice_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.invoice_payload(i.id) || jsonb_build_object('invoice_id', i.id, 'client_name', o.legal_name)
    from public.invoices i join public.organizations o on o.id = i.client_id
   where i.id = p_invoice_id
$$;

create or replace function private.notify_invoice_finance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'overdue' and old.status is distinct from 'overdue' then
    perform private.enqueue_notification('invoice:' || new.id || ':overdue', 'staff.invoice_overdue', new.shipment_id,
      jsonb_strip_nulls(private.invoice_staff_payload(new.id)), private.finance_recipients());
  end if;
  if new.disputed_at is not null and old.disputed_at is null then
    perform private.enqueue_notification(
      'invoice:' || new.id || ':dispute:' || floor(extract(epoch from new.disputed_at))::bigint, 'staff.invoice_disputed', new.shipment_id,
      jsonb_strip_nulls(private.invoice_staff_payload(new.id) || jsonb_build_object('reason', new.dispute_reason)),
      private.finance_recipients());
  end if;
  return null;
end;
$$;
create trigger invoices_notify_finance
  after update of status, disputed_at on public.invoices
  for each row execute function private.notify_invoice_finance();

-- ---------------------------------------------------------------------------
-- The daily run: overdue refresh, then reminders
-- ---------------------------------------------------------------------------
create or replace function private.finance_daily()
returns table (overdue integer, reminders integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stages   integer[] := private.reminder_stages();
  v_overdue  integer := 0;
  v_sent     integer := 0;
  rec        record;
  v_stage    integer;
  v_id       uuid;
begin
  -- 1. past their due date in the client's time zone → overdue (refresh_invoice decides)
  for rec in
    select i.id from public.invoices i join public.organizations o on o.id = i.client_id
     where i.status in ('issued', 'partially_paid')
       and i.due_date < (now() at time zone coalesce(o.timezone, 'Africa/Kigali'))::date
  loop
    perform private.refresh_invoice(rec.id);
    v_overdue := v_overdue + 1;
  end loop;

  -- 2. reminders: the latest stage reached, once
  for rec in
    select i.id, i.shipment_id, i.issue_date, i.due_date, i.balance_due, i.currency,
           (now() at time zone coalesce(o.timezone, 'Africa/Kigali'))::date as today
      from public.invoices i join public.organizations o on o.id = i.client_id
     where i.status in ('issued', 'partially_paid', 'overdue')   -- not draft, paid, void or disputed
       and i.disputed_at is null
       and o.payment_reminders and o.is_active
       and i.balance_due - private.pending_payments(i.id) > 0
  loop
    continue when rec.issue_date >= rec.today;                    -- not on the day it was issued
    select max(s) into v_stage from unnest(v_stages) s where s <= rec.today - rec.due_date;
    continue when v_stage is null;
    continue when exists (select 1 from public.invoice_reminders r where r.invoice_id = rec.id and r.stage >= v_stage);
    insert into public.invoice_reminders (invoice_id, stage, days_from_due, balance_due, currency)
    values (rec.id, v_stage, rec.today - rec.due_date, rec.balance_due, rec.currency)
    on conflict (invoice_id, stage) do nothing
    returning id into v_id;
    continue when v_id is null;
    perform private.enqueue_notification('reminder:' || rec.id || ':' || v_stage, 'invoice.reminder', rec.shipment_id,
      jsonb_strip_nulls(private.invoice_payload(rec.id) || jsonb_build_object(
        'stage', v_stage, 'days_from_due', rec.today - rec.due_date)),
      private.client_recipients(rec.shipment_id));
    v_sent := v_sent + 1;
  end loop;
  return query select v_overdue, v_sent;
end;
$$;

-- Manual run (finance / admin), same function as the schedule
create or replace function public.run_finance_reminders()
returns table (overdue integer, reminders integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.current_app_role() not in ('finance', 'admin') or private.current_app_role() is null then
    raise exception 'Only finance or an admin can run payment reminders' using errcode = '42501';
  end if;
  return query select * from private.finance_daily();
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function public.run_finance_reminders() from public, anon;
grant execute on function public.run_finance_reminders() to authenticated;
do $$
declare
  f text;
begin
  foreach f in array array[
    'private.reminder_stages()', 'private.finance_recipients()', 'private.invoice_staff_payload(uuid)',
    'private.notify_invoice_finance()', 'private.finance_daily()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Schedule: every day 04:00 UTC (06:00 Kigali / 07:00 Nairobi). Skipped without pg_cron (tests).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('ngb-finance-daily', '0 4 * * *', 'select private.finance_daily()');
  end if;
end;
$$;
