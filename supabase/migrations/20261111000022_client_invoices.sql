-- 0022: invoices in the client portal + "invoice issued" / "payment verified" notifications (FRS §7, §9, AC-11/12)
--
-- Clients still cannot read the finance tables (0021 RLS: finance readers only).
-- They read through these functions, which:
--   * return only their OWN organization's invoices (current_org_id(), active client users only);
--   * never return drafts, nor internal fields (void/dispute reasons, who recorded or verified,
--     internal payment notes, rejected payments, credit-note reasons);
--   * look up by the printed numbers (INV-…, RCPT-…), so a guessed number of another client
--     gives exactly the same empty result as a number that does not exist.

-- ---------------------------------------------------------------------------
-- Client reads
-- ---------------------------------------------------------------------------
create or replace function private.is_client_invoice(p_invoice public.invoices)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_app_role() = 'client'
     and p_invoice.client_id = private.current_org_id()
     and p_invoice.invoice_number is not null            -- never drafts
$$;

-- List (or one invoice when p_invoice_number is given)
create or replace function public.client_invoices(p_invoice_number text default null)
returns table (
  invoice_number text, status public.invoice_status, currency char(3), issue_date date, due_date date,
  subtotal numeric, tax_total numeric, total numeric, amount_paid numeric, amount_credited numeric,
  balance_due numeric, awaiting_verification numeric, shipment_reference text,
  client_note text, payment_instructions text
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.invoice_number, i.status, i.currency, i.issue_date, i.due_date,
         i.subtotal, i.tax_total, i.total, i.amount_paid, i.amount_credited,
         i.balance_due, case when i.status = 'void' then 0 else private.pending_payments(i.id) end,
         s.shipment_reference, i.client_note, i.payment_instructions
    from public.invoices i
    join public.shipments s on s.id = i.shipment_id
   where private.is_client_invoice(i)
     and (p_invoice_number is null or i.invoice_number = upper(trim(p_invoice_number)))
   order by (i.status in ('overdue', 'issued', 'partially_paid', 'disputed')) desc, i.due_date desc, i.invoice_number desc
   limit 500
$$;

create or replace function public.client_invoice_lines(p_invoice_number text)
returns table (line_no integer, description text, quantity numeric, unit_price numeric, tax_rate numeric, amount numeric, tax_amount numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select l.line_no, l.description, l.quantity, l.unit_price, l.tax_rate, l.amount, l.tax_amount
    from public.invoices i
    join public.invoice_lines l on l.invoice_id = i.id
   where i.invoice_number = upper(trim(p_invoice_number)) and private.is_client_invoice(i)
   order by l.line_no
$$;

-- Payment history: verified payments (with receipt) and payments awaiting verification;
-- rejected payments and internal notes are not shown. Credit notes: number, amount, date.
create or replace function public.client_invoice_activity(p_invoice_number text)
returns table (kind text, number text, amount numeric, occurred_at timestamptz, method public.payment_method,
               transaction_reference text, verified boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select 'payment', r.receipt_number, p.amount, p.paid_at, p.method, p.transaction_reference, r.payment_id is not null
    from public.invoices i
    join public.payments p on p.invoice_id = i.id
    left join public.payment_reviews r on r.payment_id = p.id
   where i.invoice_number = upper(trim(p_invoice_number)) and private.is_client_invoice(i)
     and (r.decision is null or r.decision = 'verified')
  union all
  select 'credit_note', c.credit_note_number, c.amount, c.created_at, null, null, true
    from public.invoices i
    join public.credit_notes c on c.invoice_id = i.id
   where i.invoice_number = upper(trim(p_invoice_number)) and private.is_client_invoice(i)
  order by 4 desc
$$;

-- One receipt (verified payments only)
create or replace function public.client_receipt(p_receipt_number text)
returns table (receipt_number text, amount numeric, currency char(3), paid_at timestamptz, method public.payment_method,
               transaction_reference text, verified_at timestamptz, invoice_number text, invoice_total numeric,
               balance_due numeric, shipment_reference text, client_name text, client_tax_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.receipt_number, p.amount, p.currency, p.paid_at, p.method, p.transaction_reference, r.reviewed_at,
         i.invoice_number, i.total, i.balance_due, s.shipment_reference, o.legal_name, o.tax_id
    from public.payment_reviews r
    join public.payments p on p.id = r.payment_id
    join public.invoices i on i.id = p.invoice_id
    join public.shipments s on s.id = i.shipment_id
    join public.organizations o on o.id = i.client_id
   where r.receipt_number = upper(trim(p_receipt_number)) and r.decision = 'verified'
     and private.is_client_invoice(i)
$$;

-- ---------------------------------------------------------------------------
-- Notifications (client audience; push + WhatsApp per notification_rules)
-- ---------------------------------------------------------------------------
insert into public.notification_rules (template_key, audience, push, whatsapp, description) values
  ('invoice.issued',   'client', true, true, 'Invoice issued: number, amount, due date, payment instructions'),
  ('payment.verified', 'client', true, true, 'Payment verified: amount, reference, remaining balance, receipt');

-- Amounts travel as exact text (never floats) inside the payload
create or replace function private.invoice_payload(p_invoice_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.shipment_payload(i.shipment_id) || jsonb_build_object(
           'invoice_number', i.invoice_number, 'currency', i.currency, 'total', i.total::text,
           'balance_due', i.balance_due::text, 'due_date', i.due_date, 'issue_date', i.issue_date,
           'payment_instructions', i.payment_instructions)
    from public.invoices i where i.id = p_invoice_id
$$;

-- Issued: when a draft becomes issued (fires once; numbers are never reassigned)
create or replace function private.notify_invoice_issued()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'draft' and new.status not in ('draft', 'void') and new.invoice_number is not null then
    perform private.enqueue_notification('invoice:' || new.id || ':issued', 'invoice.issued', new.shipment_id,
      jsonb_strip_nulls(private.invoice_payload(new.id)), private.client_recipients(new.shipment_id));
  end if;
  return null;
end;
$$;
create trigger invoices_notify_issued
  after update of status on public.invoices
  for each row execute function private.notify_invoice_issued();

-- Verified: deferred to commit, so the payload has the balance AFTER this payment
create or replace function private.notify_payment_verified()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payments;
begin
  if new.decision <> 'verified' then
    return null;
  end if;
  select * into p from public.payments x where x.id = new.payment_id;
  perform private.enqueue_notification('payment:' || new.payment_id || ':verified', 'payment.verified',
    (select i.shipment_id from public.invoices i where i.id = p.invoice_id),
    jsonb_strip_nulls(private.invoice_payload(p.invoice_id) || jsonb_build_object(
      'amount', p.amount::text, 'transaction_reference', p.transaction_reference, 'receipt_number', new.receipt_number)),
    private.client_recipients((select i.shipment_id from public.invoices i where i.id = p.invoice_id)));
  return null;
end;
$$;
create constraint trigger payment_reviews_notify
  after insert on public.payment_reviews
  deferrable initially deferred
  for each row execute function private.notify_payment_verified();

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.client_invoices(text)', 'public.client_invoice_lines(text)',
    'public.client_invoice_activity(text)', 'public.client_receipt(text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'private.is_client_invoice(public.invoices)', 'private.invoice_payload(uuid)',
    'private.notify_invoice_issued()', 'private.notify_payment_verified()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;
