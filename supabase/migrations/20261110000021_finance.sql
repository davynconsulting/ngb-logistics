-- ============================================================================
-- 0021 · Invoices, payments, credit notes (FRS §6.7, §9; AC-11, AC-12)
--
-- Decisions (2026-11-05): tax rate per invoice line; invoice numbers
-- INV-YYYY-NNNNN, gap-free, assigned only when an invoice is issued; the same
-- finance user may record and verify a payment (both are logged).
--
-- Rules enforced here, not in the app:
-- * Money is numeric(14,2); quantities numeric(12,3); totals are computed by
--   the database from the lines and frozen when the invoice is issued.
-- * One currency per invoice; a payment or credit note in another currency is
--   refused (no mixing currencies in a balance).
-- * Payments are append-only. Verification is a separate, one-time decision
--   (verified + receipt number, or rejected + reason). Only VERIFIED payments
--   reduce the balance; an invoice is never "paid" because it was created.
-- * The balance can never go negative: recording, verifying and crediting are
--   all checked against what is left.
-- * Invoice status and the shipment's finance status are derived, never typed.
-- * Finance tables are readable by finance, admin and the operations manager
--   only; nobody writes them directly (functions only). Clients read their
--   invoices through client-safe functions (added with the portal pages).
-- * Every change is in the audit log.
-- ============================================================================

create type public.invoice_status as enum
  ('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'disputed', 'void');
create type public.payment_method as enum
  ('bank_transfer', 'mobile_money', 'cash', 'card', 'other');
create type public.payment_decision as enum ('verified', 'rejected');

-- ---------------------------------------------------------------------------
-- Gap-free numbering (row lock per kind and year; rolls back with the caller)
-- ---------------------------------------------------------------------------
create table public.document_sequences (
  kind         text not null check (kind in ('INV', 'CN', 'RCPT')),
  year         integer not null check (year between 2000 and 2100),
  last_number  integer not null default 0 check (last_number >= 0),
  primary key (kind, year)
);

create or replace function private.next_finance_number(p_kind text, p_year integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into public.document_sequences (kind, year, last_number) values (p_kind, p_year, 1)
  on conflict (kind, year) do update set last_number = public.document_sequences.last_number + 1
  returning last_number into v_n;
  return format('%s-%s-%s', p_kind, p_year, lpad(v_n::text, 5, '0'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.invoices (
  id                    uuid primary key default gen_random_uuid(),
  invoice_number        text unique check (invoice_number ~ '^INV-[0-9]{4}-[0-9]{5,}$'),
  client_id             uuid not null references public.organizations (id),
  shipment_id           uuid not null references public.shipments (id) on delete restrict,
  currency              char(3) not null check (currency in ('USD', 'TZS', 'KES', 'RWF')),
  status                public.invoice_status not null default 'draft',
  issue_date            date,
  due_date              date,
  subtotal              numeric(14,2) not null default 0 check (subtotal >= 0),
  tax_total             numeric(14,2) not null default 0 check (tax_total >= 0),
  total                 numeric(14,2) not null default 0 check (total >= 0),
  amount_paid           numeric(14,2) not null default 0 check (amount_paid >= 0),
  amount_credited       numeric(14,2) not null default 0 check (amount_credited >= 0),
  balance_due           numeric(14,2) not null default 0 check (balance_due >= 0),
  client_note           text check (length(client_note) <= 2000),
  payment_instructions  text check (length(payment_instructions) <= 2000),
  disputed_at           timestamptz,
  disputed_by           uuid references public.profiles (id),
  dispute_reason        text check (length(dispute_reason) <= 1000),
  voided_at             timestamptz,
  voided_by             uuid references public.profiles (id),
  void_reason           text check (length(void_reason) <= 1000),
  issued_at             timestamptz,
  issued_by             uuid references public.profiles (id),
  created_by            uuid references public.profiles (id) default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint invoice_totals_add_up check (total = subtotal + tax_total),
  constraint invoice_balance_adds_up check (status in ('draft', 'void') or balance_due = total - amount_paid - amount_credited),
  constraint invoice_issued_has_number check (
    (status in ('draft') and invoice_number is null and issued_at is null)
    or (status = 'void' and void_reason is not null and voided_at is not null)
    or (status not in ('draft', 'void') and invoice_number is not null and issue_date is not null
        and due_date is not null and issued_at is not null)),
  constraint invoice_due_after_issue check (due_date is null or issue_date is null or due_date >= issue_date),
  constraint invoice_dispute_has_reason check (disputed_at is null or dispute_reason is not null)
);
create index invoices_shipment_idx on public.invoices (shipment_id);
create index invoices_client_idx on public.invoices (client_id, status);
create index invoices_due_idx on public.invoices (due_date) where status in ('issued', 'partially_paid', 'overdue', 'disputed');

create table public.invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices (id) on delete restrict,
  line_no      integer not null check (line_no between 1 and 50),
  description  text not null check (length(trim(description)) between 1 and 300),
  quantity     numeric(12,3) not null check (quantity > 0),
  unit_price   numeric(14,2) not null check (unit_price >= 0),
  tax_rate     numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  amount       numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  tax_amount   numeric(14,2) generated always as (round(round(quantity * unit_price, 2) * tax_rate / 100, 2)) stored,
  unique (invoice_id, line_no)
);

create table public.payments (
  id                     uuid primary key default gen_random_uuid(),
  invoice_id             uuid not null references public.invoices (id) on delete restrict,
  amount                 numeric(14,2) not null check (amount > 0),
  currency               char(3) not null check (currency in ('USD', 'TZS', 'KES', 'RWF')),
  paid_at                timestamptz not null,
  method                 public.payment_method not null,
  transaction_reference  text check (length(trim(transaction_reference)) between 1 and 100),
  note                   text check (length(note) <= 1000),
  receipt_document_id    uuid references public.documents (id),
  recorded_by            uuid references public.profiles (id) default auth.uid(),
  recorded_at            timestamptz not null default now(),
  constraint payment_reference_unless_cash check (method = 'cash' or transaction_reference is not null)
);
create index payments_invoice_idx on public.payments (invoice_id);
create unique index payments_reference_once on public.payments (invoice_id, upper(transaction_reference))
  where transaction_reference is not null;

create table public.payment_reviews (
  payment_id      uuid primary key references public.payments (id) on delete restrict,
  decision        public.payment_decision not null,
  receipt_number  text unique check (receipt_number ~ '^RCPT-[0-9]{4}-[0-9]{5,}$'),
  reason          text check (length(reason) <= 1000),
  reviewed_by     uuid references public.profiles (id) default auth.uid(),
  reviewed_at     timestamptz not null default now(),
  constraint review_outcome check (
    (decision = 'verified' and receipt_number is not null)
    or (decision = 'rejected' and receipt_number is null and reason is not null))
);

create table public.credit_notes (
  id                  uuid primary key default gen_random_uuid(),
  credit_note_number  text not null unique check (credit_note_number ~ '^CN-[0-9]{4}-[0-9]{5,}$'),
  invoice_id          uuid not null references public.invoices (id) on delete restrict,
  amount              numeric(14,2) not null check (amount > 0),
  currency            char(3) not null check (currency in ('USD', 'TZS', 'KES', 'RWF')),
  reason              text not null check (length(trim(reason)) between 3 and 1000),
  created_by          uuid references public.profiles (id) default auth.uid(),
  created_at          timestamptz not null default now()
);
create index credit_notes_invoice_idx on public.credit_notes (invoice_id);

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------
create trigger invoices_updated_at before update on public.invoices
  for each row execute function private.set_updated_at();

-- Lines change only while the invoice is a draft; totals follow the lines
create or replace function private.invoice_lines_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  if (select i.status from public.invoices i where i.id = v_invoice) is distinct from 'draft' then
    raise exception 'Invoice lines can only change while the invoice is a draft' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' and new.invoice_id <> old.invoice_id then
    raise exception 'A line cannot move to another invoice' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger invoice_lines_draft_only before insert or update or delete on public.invoice_lines
  for each row execute function private.invoice_lines_guard();

create or replace function private.invoice_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  update public.invoices i
     set subtotal = t.sub, tax_total = t.tax, total = t.sub + t.tax
    from (select coalesce(sum(l.amount), 0) sub, coalesce(sum(l.tax_amount), 0) tax
            from public.invoice_lines l where l.invoice_id = v_invoice) t
   where i.id = v_invoice;
  return null;
end;
$$;
create trigger invoice_lines_totals after insert or update or delete on public.invoice_lines
  for each row execute function private.invoice_totals();

-- What was issued is frozen: only status, derived amounts, dispute and void change afterwards
create or replace function private.invoice_freeze()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'void' then
    raise exception 'A void invoice cannot change' using errcode = '55000';
  end if;
  if old.status <> 'draft' and (
       new.invoice_number, new.client_id, new.shipment_id, new.currency, new.issue_date, new.due_date,
       new.subtotal, new.tax_total, new.total, new.client_note, new.payment_instructions, new.issued_at, new.issued_by)
     is distinct from (
       old.invoice_number, old.client_id, old.shipment_id, old.currency, old.issue_date, old.due_date,
       old.subtotal, old.tax_total, old.total, old.client_note, old.payment_instructions, old.issued_at, old.issued_by) then
    raise exception 'An issued invoice cannot be edited; use a credit note or void it' using errcode = '55000';
  end if;
  if new.status = 'draft' and old.status <> 'draft' then
    raise exception 'An issued invoice cannot go back to draft' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger invoices_freeze before update on public.invoices
  for each row execute function private.invoice_freeze();

-- Payment and credit currency = invoice currency (FRS §9 rule 2)
create or replace function private.finance_currency_matches()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.currency is distinct from (select i.currency from public.invoices i where i.id = new.invoice_id) then
    raise exception 'The currency must be the invoice currency' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger payments_currency before insert on public.payments
  for each row execute function private.finance_currency_matches();
create trigger credit_notes_currency before insert on public.credit_notes
  for each row execute function private.finance_currency_matches();

-- Append-only (UPDATE/DELETE blocked for every role)
create trigger payments_append_only before update or delete on public.payments
  for each row execute function private.prevent_mutation();
create trigger payment_reviews_append_only before update or delete on public.payment_reviews
  for each row execute function private.prevent_mutation();
create trigger credit_notes_append_only before update or delete on public.credit_notes
  for each row execute function private.prevent_mutation();
create trigger invoices_no_delete before delete on public.invoices
  for each row execute function private.prevent_mutation();

-- Audit
create trigger audit_invoices after insert or update or delete on public.invoices
  for each row execute function private.audit_row();
create trigger audit_invoice_lines after insert or update or delete on public.invoice_lines
  for each row execute function private.audit_row();
create trigger audit_payments after insert on public.payments
  for each row execute function private.audit_row();
create trigger audit_payment_reviews after insert on public.payment_reviews
  for each row execute function private.audit_row();
create trigger audit_credit_notes after insert on public.credit_notes
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- Derived statuses
-- ---------------------------------------------------------------------------
-- Shipment finance status from its issued invoices
create or replace function private.refresh_shipment_finance(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new public.finance_status;
begin
  select case
           when count(*) = 0 then 'not_invoiced'
           when bool_or(i.status = 'disputed') then 'disputed'
           when bool_or(i.status = 'overdue') then 'overdue'
           when bool_and(i.status = 'paid') then 'paid'
           when bool_or(i.status in ('partially_paid', 'paid')) then 'partially_paid'
           else 'invoiced'
         end::public.finance_status
    into v_new
    from public.invoices i
   where i.shipment_id = p_shipment_id and i.status not in ('draft', 'void');
  update public.shipments s set finance_status = v_new
   where s.id = p_shipment_id and s.finance_status is distinct from v_new;
end;
$$;

-- Invoice amounts and status from verified payments, credit notes, dispute and due date
create or replace function private.refresh_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i          public.invoices;
  v_paid     numeric(14,2);
  v_credit   numeric(14,2);
  v_balance  numeric(14,2);
  v_today    date;
  v_status   public.invoice_status;
begin
  select * into i from public.invoices x where x.id = p_invoice_id for update;
  if not found then return; end if;
  if i.status not in ('draft', 'void') then
    select coalesce(sum(p.amount), 0) into v_paid
      from public.payments p join public.payment_reviews r on r.payment_id = p.id and r.decision = 'verified'
     where p.invoice_id = i.id;
    select coalesce(sum(c.amount), 0) into v_credit from public.credit_notes c where c.invoice_id = i.id;
    v_balance := i.total - v_paid - v_credit;
    if v_balance < 0 then
      raise exception 'The balance cannot go below zero' using errcode = '22023';
    end if;
    select (now() at time zone coalesce(o.timezone, 'Africa/Kigali'))::date into v_today
      from public.organizations o where o.id = i.client_id;
    v_status := case
      when v_balance = 0 then 'paid'
      when i.disputed_at is not null then 'disputed'
      when i.due_date < v_today then 'overdue'
      when v_paid > 0 or v_credit > 0 then 'partially_paid'
      else 'issued' end;
    update public.invoices x
       set status = v_status, amount_paid = v_paid, amount_credited = v_credit, balance_due = v_balance
     where x.id = i.id
       and (x.status, x.amount_paid, x.amount_credited, x.balance_due) is distinct from (v_status, v_paid, v_credit, v_balance);
  end if;
  perform private.refresh_shipment_finance(i.shipment_id);
end;
$$;

-- Who works with money
create or replace function private.is_finance_reader()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_app_role() in ('finance', 'admin', 'ops_manager'), false)
$$;

-- Amount of payments recorded but not yet reviewed
create or replace function private.pending_payments(p_invoice_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(p.amount), 0) from public.payments p
   where p.invoice_id = p_invoice_id
     and not exists (select 1 from public.payment_reviews r where r.payment_id = p.id)
$$;

-- ---------------------------------------------------------------------------
-- Functions (the only way to write finance data)
-- ---------------------------------------------------------------------------
-- Create or replace a draft. p_lines: [{description, quantity, unit_price, tax_rate}]
create or replace function public.save_invoice_draft(
  p_invoice_id            uuid,
  p_shipment_id           uuid,
  p_currency              text,
  p_lines                 jsonb,
  p_client_note           text default null,
  p_payment_instructions  text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s        public.shipments;
  i        public.invoices;
  v_id     uuid;
  v_line   jsonb;
  v_n      integer := 0;
  v_qty    numeric;
  v_price  numeric;
  v_rate   numeric;
begin
  if private.current_app_role() not in ('finance', 'admin') or private.current_app_role() is null then
    raise exception 'Only finance can prepare invoices' using errcode = '42501';
  end if;
  select * into s from public.shipments x where x.id = p_shipment_id;
  if not found then
    raise exception 'Shipment not found' using errcode = 'P0002';
  end if;
  if s.overall_status = 'closed' then
    raise exception 'This shipment is closed' using errcode = '55000';
  end if;
  if p_currency is null or p_currency not in ('USD', 'TZS', 'KES', 'RWF') then
    raise exception 'Choose the currency (USD, TZS, KES or RWF)' using errcode = '22023';
  end if;
  -- two steps: SQL does not promise to short-circuit OR
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'Add between 1 and 50 lines' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception 'Add between 1 and 50 lines' using errcode = '22023';
  end if;
  if length(p_client_note) > 2000 or length(p_payment_instructions) > 2000 then
    raise exception 'A text field is too long' using errcode = '22023';
  end if;

  if p_invoice_id is null then
    insert into public.invoices (client_id, shipment_id, currency, client_note, payment_instructions)
    values (s.client_id, s.id, p_currency, nullif(trim(p_client_note), ''), nullif(trim(p_payment_instructions), ''))
    returning id into v_id;
  else
    select * into i from public.invoices x where x.id = p_invoice_id for update;
    if not found then
      raise exception 'Invoice not found' using errcode = 'P0002';
    end if;
    if i.status <> 'draft' then
      raise exception 'Only a draft can be edited' using errcode = '55000';
    end if;
    if i.shipment_id <> p_shipment_id then
      raise exception 'A draft cannot move to another shipment' using errcode = '22023';
    end if;
    update public.invoices x set currency = p_currency, client_note = nullif(trim(p_client_note), ''),
           payment_instructions = nullif(trim(p_payment_instructions), '')
     where x.id = i.id;
    delete from public.invoice_lines l where l.invoice_id = i.id;
    v_id := i.id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_n := v_n + 1;
    begin
      v_qty   := (v_line ->> 'quantity')::numeric;
      v_price := (v_line ->> 'unit_price')::numeric;
      v_rate  := coalesce((v_line ->> 'tax_rate')::numeric, 0);
    exception when others then
      raise exception 'Line %: enter numbers for quantity, price and tax rate', v_n using errcode = '22023';
    end;
    if v_price is null or v_price <> round(v_price, 2) or v_qty is null or v_qty <> round(v_qty, 3) or v_rate <> round(v_rate, 2) then
      raise exception 'Line %: prices have at most 2 decimals, quantities 3', v_n using errcode = '22023';
    end if;
    if nullif(trim(v_line ->> 'description'), '') is null then
      raise exception 'Line %: enter a description', v_n using errcode = '22023';
    end if;
    insert into public.invoice_lines (invoice_id, line_no, description, quantity, unit_price, tax_rate)
    values (v_id, v_n, trim(v_line ->> 'description'), v_qty, v_price, v_rate);
  end loop;
  return v_id;
exception
  when check_violation then
    raise exception 'Check the lines: quantities above 0, prices 0 or more, tax rate 0 to 100' using errcode = '22023';
  when numeric_value_out_of_range then
    raise exception 'An amount is too large' using errcode = '22023';
end;
$$;

-- Issue: number, dates, frozen from now on
create or replace function public.issue_invoice(p_invoice_id uuid, p_issue_date date default null, p_due_date date default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  i        public.invoices;
  v_today  date;
  v_terms  integer;
  v_issue  date;
  v_due    date;
  v_number text;
begin
  if private.current_app_role() not in ('finance', 'admin') or private.current_app_role() is null then
    raise exception 'Only finance can issue invoices' using errcode = '42501';
  end if;
  select * into i from public.invoices x where x.id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  if i.status <> 'draft' then
    raise exception 'This invoice is already issued or void' using errcode = '55000';
  end if;
  if i.total <= 0 then
    raise exception 'The invoice total must be above zero' using errcode = '22023';
  end if;
  select (now() at time zone coalesce(o.timezone, 'Africa/Kigali'))::date, coalesce(o.billing_terms_days, 30)
    into v_today, v_terms from public.organizations o where o.id = i.client_id;
  v_issue := coalesce(p_issue_date, v_today);
  if v_issue > v_today or v_issue < v_today - 60 then
    raise exception 'The issue date must be today or within the last 60 days' using errcode = '22023';
  end if;
  v_due := coalesce(p_due_date, v_issue + v_terms);
  if v_due < v_issue or v_due > v_issue + 365 then
    raise exception 'The due date must be on or after the issue date (within a year)' using errcode = '22023';
  end if;
  v_number := private.next_finance_number('INV', extract(year from v_issue)::integer);
  update public.invoices x
     set invoice_number = v_number, issue_date = v_issue, due_date = v_due,
         status = 'issued', issued_at = now(), issued_by = auth.uid(),
         amount_paid = 0, amount_credited = 0, balance_due = x.total
   where x.id = i.id;
  perform private.refresh_invoice(i.id);
  return v_number;
end;
$$;

-- Record a payment received (not counted until verified)
create or replace function public.record_payment(
  p_invoice_id  uuid,
  p_amount      numeric,
  p_currency    text,
  p_paid_at     timestamptz,
  p_method      public.payment_method,
  p_reference   text default null,
  p_note        text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  i      public.invoices;
  v_ref  text := nullif(trim(p_reference), '');
  v_id   uuid;
begin
  if private.current_app_role() not in ('finance', 'admin') or private.current_app_role() is null then
    raise exception 'Only finance can record payments' using errcode = '42501';
  end if;
  select * into i from public.invoices x where x.id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  if i.status in ('draft', 'void', 'paid') then
    raise exception 'Payments can only be recorded on an issued, unpaid invoice' using errcode = '55000';
  end if;
  if p_currency is distinct from i.currency then
    raise exception 'This invoice is in %; record the payment in that currency', i.currency using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Enter an amount above zero with at most 2 decimals' using errcode = '22023';
  end if;
  if p_amount > i.balance_due - private.pending_payments(i.id) then
    raise exception 'The amount is more than what is left to pay (% %, including payments awaiting verification)',
      i.balance_due - private.pending_payments(i.id), i.currency using errcode = '22023';
  end if;
  if p_paid_at is null or p_paid_at > now() + interval '10 minutes' or p_paid_at < now() - interval '1 year' then
    raise exception 'The payment date must be within the last year and not in the future' using errcode = '22023';
  end if;
  if p_method <> 'cash' and v_ref is null then
    raise exception 'Enter the transaction reference' using errcode = '22023';
  end if;
  if length(v_ref) > 100 or length(p_note) > 1000 then
    raise exception 'A text field is too long' using errcode = '22023';
  end if;
  begin
    insert into public.payments (invoice_id, amount, currency, paid_at, method, transaction_reference, note)
    values (i.id, p_amount, p_currency, p_paid_at, p_method, v_ref, nullif(trim(p_note), ''))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'A payment with this reference is already recorded on this invoice' using errcode = '22023';
  end;
  return v_id;
end;
$$;

-- Verify (finance only; receipt number) or reject (with a reason). Once per payment.
create or replace function public.review_payment(p_payment_id uuid, p_decision public.payment_decision, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p          public.payments;
  i          public.invoices;
  v_reason   text := nullif(trim(p_reason), '');
  v_receipt  text;
begin
  if private.current_app_role() is distinct from 'finance' then
    raise exception 'Only finance can verify payments' using errcode = '42501';
  end if;
  select * into p from public.payments x where x.id = p_payment_id;
  if not found then
    raise exception 'Payment not found' using errcode = 'P0002';
  end if;
  select * into i from public.invoices x where x.id = p.invoice_id for update;
  if exists (select 1 from public.payment_reviews r where r.payment_id = p.id) then
    raise exception 'This payment has already been reviewed' using errcode = '55000';
  end if;
  if p_decision is null then
    raise exception 'Choose verify or reject' using errcode = '22023';
  end if;
  if length(v_reason) > 1000 then
    raise exception 'The reason is too long' using errcode = '22023';
  end if;
  if p_decision = 'verified' then
    if i.status = 'void' then
      raise exception 'The invoice is void' using errcode = '55000';
    end if;
    if p.amount > i.balance_due then
      raise exception 'Verifying this would pay more than the balance (% %)', i.balance_due, i.currency using errcode = '22023';
    end if;
    v_receipt := private.next_finance_number('RCPT', extract(year from (now() at time zone 'Africa/Kigali'))::integer);
  elsif v_reason is null or length(v_reason) < 3 then
    raise exception 'Give the reason for rejecting this payment' using errcode = '22023';
  end if;
  insert into public.payment_reviews (payment_id, decision, receipt_number, reason)
  values (p.id, p_decision, v_receipt, v_reason);
  perform private.refresh_invoice(i.id);
  return v_receipt;
end;
$$;

-- Authorised reduction of what is owed
create or replace function public.issue_credit_note(p_invoice_id uuid, p_amount numeric, p_currency text, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  i         public.invoices;
  v_reason  text := nullif(trim(p_reason), '');
  v_number  text;
begin
  if private.current_app_role() not in ('finance', 'admin') or private.current_app_role() is null then
    raise exception 'Only finance can issue credit notes' using errcode = '42501';
  end if;
  select * into i from public.invoices x where x.id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  if i.status in ('draft', 'void', 'paid') then
    raise exception 'Credit notes apply to an issued invoice with a balance' using errcode = '55000';
  end if;
  if p_currency is distinct from i.currency then
    raise exception 'The credit note must be in % (the invoice currency)', i.currency using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Enter an amount above zero with at most 2 decimals' using errcode = '22023';
  end if;
  if p_amount > i.balance_due - private.pending_payments(i.id) then
    raise exception 'The credit is more than what is left to pay (% %, including payments awaiting verification)',
      i.balance_due - private.pending_payments(i.id), i.currency using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 1000 then
    raise exception 'Give the reason for the credit (3 to 1000 characters)' using errcode = '22023';
  end if;
  v_number := private.next_finance_number('CN', extract(year from (now() at time zone 'Africa/Kigali'))::integer);
  insert into public.credit_notes (credit_note_number, invoice_id, amount, currency, reason)
  values (v_number, i.id, p_amount, p_currency, v_reason);
  perform private.refresh_invoice(i.id);
  return v_number;
end;
$$;

-- Void: a draft, or an issued invoice with no payments or credits at all
create or replace function public.void_invoice(p_invoice_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i         public.invoices;
  v_reason  text := nullif(trim(p_reason), '');
begin
  if private.current_app_role() not in ('finance', 'admin') or private.current_app_role() is null then
    raise exception 'Only finance can void invoices' using errcode = '42501';
  end if;
  select * into i from public.invoices x where x.id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  if i.status = 'void' then
    raise exception 'This invoice is already void' using errcode = '55000';
  end if;
  if exists (select 1 from public.payments p where p.invoice_id = i.id)
     or exists (select 1 from public.credit_notes c where c.invoice_id = i.id) then
    raise exception 'This invoice has payments or credit notes; use a credit note instead' using errcode = '55000';
  end if;
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 1000 then
    raise exception 'Give the reason for voiding (3 to 1000 characters)' using errcode = '22023';
  end if;
  update public.invoices x
     set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = v_reason,
         balance_due = 0
   where x.id = i.id;
  perform private.refresh_shipment_finance(i.shipment_id);
end;
$$;

-- Open or resolve a dispute (reminders pause while disputed)
create or replace function public.set_invoice_dispute(p_invoice_id uuid, p_open boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i         public.invoices;
  v_reason  text := nullif(trim(p_reason), '');
begin
  if private.current_app_role() not in ('finance', 'admin', 'ops_manager') or private.current_app_role() is null then
    raise exception 'You are not allowed to change disputes' using errcode = '42501';
  end if;
  select * into i from public.invoices x where x.id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  if i.status in ('draft', 'void', 'paid') then
    raise exception 'Only an issued, unpaid invoice can be disputed' using errcode = '55000';
  end if;
  if p_open is null then
    raise exception 'Say whether the dispute is opened or resolved' using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 1000 then
    raise exception 'Give the reason (3 to 1000 characters)' using errcode = '22023';
  end if;
  if p_open then
    if i.disputed_at is not null then
      raise exception 'This invoice is already disputed' using errcode = '55000';
    end if;
    update public.invoices x set disputed_at = now(), disputed_by = auth.uid(), dispute_reason = v_reason where x.id = i.id;
  else
    if i.disputed_at is null then
      raise exception 'This invoice is not disputed' using errcode = '55000';
    end if;
    -- the resolution note is kept in the audit log (dispute_reason before/after)
    update public.invoices x set disputed_at = null, disputed_by = null, dispute_reason = null where x.id = i.id;
    insert into public.audit_log (actor_id, actor_role, table_name, record_id, action, new_data)
    values (auth.uid(), 'authenticated', 'invoice_disputes', i.id::text, 'UPDATE',
            jsonb_build_object('resolved', true, 'resolution', v_reason, 'dispute_reason', i.dispute_reason));
  end if;
  perform private.refresh_invoice(i.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and RLS: finance readers only; no direct writes
-- ---------------------------------------------------------------------------
alter table public.document_sequences enable row level security;
alter table public.invoices          enable row level security;
alter table public.invoice_lines     enable row level security;
alter table public.payments          enable row level security;
alter table public.payment_reviews   enable row level security;
alter table public.credit_notes      enable row level security;

revoke all on public.document_sequences, public.invoices, public.invoice_lines, public.payments,
              public.payment_reviews, public.credit_notes from anon, authenticated;
grant select on public.invoices, public.invoice_lines, public.payments, public.payment_reviews,
                public.credit_notes to authenticated;

create policy invoices_select on public.invoices for select to authenticated
  using ((select private.is_finance_reader()));
create policy invoice_lines_select on public.invoice_lines for select to authenticated
  using ((select private.is_finance_reader()));
create policy payments_select on public.payments for select to authenticated
  using ((select private.is_finance_reader()));
create policy payment_reviews_select on public.payment_reviews for select to authenticated
  using ((select private.is_finance_reader()));
create policy credit_notes_select on public.credit_notes for select to authenticated
  using ((select private.is_finance_reader()));

revoke all on function public.save_invoice_draft(uuid, uuid, text, jsonb, text, text) from public, anon;
revoke all on function public.issue_invoice(uuid, date, date) from public, anon;
revoke all on function public.record_payment(uuid, numeric, text, timestamptz, public.payment_method, text, text) from public, anon;
revoke all on function public.review_payment(uuid, public.payment_decision, text) from public, anon;
revoke all on function public.issue_credit_note(uuid, numeric, text, text) from public, anon;
revoke all on function public.void_invoice(uuid, text) from public, anon;
revoke all on function public.set_invoice_dispute(uuid, boolean, text) from public, anon;
grant execute on function public.save_invoice_draft(uuid, uuid, text, jsonb, text, text) to authenticated;
grant execute on function public.issue_invoice(uuid, date, date) to authenticated;
grant execute on function public.record_payment(uuid, numeric, text, timestamptz, public.payment_method, text, text) to authenticated;
grant execute on function public.review_payment(uuid, public.payment_decision, text) to authenticated;
grant execute on function public.issue_credit_note(uuid, numeric, text, text) to authenticated;
grant execute on function public.void_invoice(uuid, text) to authenticated;
grant execute on function public.set_invoice_dispute(uuid, boolean, text) to authenticated;

-- internal helpers are not callable by users
revoke all on function private.next_finance_number(text, integer) from public, anon, authenticated;
revoke all on function private.refresh_invoice(uuid) from public, anon, authenticated;
revoke all on function private.refresh_shipment_finance(uuid) from public, anon, authenticated;
revoke all on function private.pending_payments(uuid) from public, anon, authenticated;
