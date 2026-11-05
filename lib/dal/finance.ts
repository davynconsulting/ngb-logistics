import "server-only";
import { createClient } from "@/lib/supabase/server";
import { filterStatuses, type InvoiceFilter } from "@/lib/domain/finance";

/*
 * Finance reads AS THE SIGNED-IN USER. RLS (0021) lets only finance, admin and
 * ops managers read invoices, lines, payments, reviews and credit notes; anyone
 * else gets empty results. PostgREST sends numerics as JSON numbers; they are
 * turned into fixed 2-decimal strings right here and the app uses strings from
 * then on. This is exact: numeric(14,2) holds at most 10^14 cents, well below
 * 2^53, so the nearest double always prints back to the same 2 decimals.
 */

/** numeric(14,2) → "1234.50". PostgREST sends numerics as JSON numbers. */
const money = (v: number | string | null | undefined) => (v == null ? "0.00" : typeof v === "string" ? v : v.toFixed(2));
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

const INVOICE_LIST = `id, invoice_number, status, currency, issue_date, due_date, total, balance_due, disputed_at, created_at,
  client:organizations!invoices_client_id_fkey(legal_name, client_code),
  shipment:shipments!invoices_shipment_id_fkey(id, shipment_reference)`;

export async function listInvoices({ filter, q, limit = 100 }: { filter: InvoiceFilter; q?: string; limit?: number }) {
  const supabase = await createClient();
  let query = supabase.from("invoices").select(INVOICE_LIST);
  const statuses = filterStatuses(filter);
  if (statuses) query = query.in("status", statuses);
  const term = q?.trim().replace(/[^A-Za-z0-9-]/g, "").toUpperCase();
  if (term) query = query.ilike("invoice_number", `%${term}%`);
  const { data, error } = await query
    .order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error("Could not load invoices");
  return data.map((i) => ({ ...i, total: money(i.total), balance_due: money(i.balance_due), client: one(i.client), shipment: one(i.shipment) }));
}
export type InvoiceListItem = Awaited<ReturnType<typeof listInvoices>>[number];

export async function listShipmentInvoices(shipmentId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("invoices").select(INVOICE_LIST)
    .eq("shipment_id", shipmentId).order("created_at", { ascending: false });
  if (error) throw new Error("Could not load invoices");
  return data.map((i) => ({ ...i, total: money(i.total), balance_due: money(i.balance_due), client: one(i.client), shipment: one(i.shipment) }));
}

/** Totals still owed per currency over open invoices (never added across currencies). */
export async function getReceivables() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("invoices").select("currency, balance_due, status")
    .in("status", ["issued", "partially_paid", "overdue", "disputed"]).limit(5000);
  if (error) throw new Error("Could not load balances");
  return data.map((r) => ({ currency: r.currency, status: r.status, balance_due: money(r.balance_due) }));
}

export async function getInvoice(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("invoices")
    .select(`id, invoice_number, status, currency, issue_date, due_date, subtotal, tax_total, total, amount_paid,
      amount_credited, balance_due, client_note, payment_instructions, disputed_at, dispute_reason, voided_at,
      void_reason, issued_at, created_at, client_id, shipment_id,
      client:organizations!invoices_client_id_fkey(legal_name, client_code, billing_address, tax_id, timezone, billing_terms_days),
      shipment:shipments!invoices_shipment_id_fkey(id, shipment_reference, bl_number, overall_status),
      issuer:profiles!invoices_issued_by_fkey(full_name),
      lines:invoice_lines(id, line_no, description, quantity, unit_price, tax_rate, amount, tax_amount),
      payments(id, amount, currency, paid_at, method, transaction_reference, note, recorded_at,
        recorder:profiles!payments_recorded_by_fkey(full_name),
        review:payment_reviews(decision, receipt_number, reason, reviewed_at, reviewer:profiles!payment_reviews_reviewed_by_fkey(full_name))),
      credit_notes(id, credit_note_number, amount, reason, created_at, creator:profiles!credit_notes_created_by_fkey(full_name))`)
    .eq("id", id).maybeSingle();
  if (error) throw new Error("Could not load the invoice");
  if (!data) return null;
  return {
    ...data,
    subtotal: money(data.subtotal), tax_total: money(data.tax_total), total: money(data.total),
    amount_paid: money(data.amount_paid), amount_credited: money(data.amount_credited), balance_due: money(data.balance_due),
    client: one(data.client), shipment: one(data.shipment), issuer: one(data.issuer),
    lines: [...data.lines].sort((a, b) => a.line_no - b.line_no).map((l) => ({
      ...l, quantity: String(l.quantity), unit_price: money(l.unit_price), tax_rate: String(l.tax_rate),
      amount: money(l.amount), tax_amount: money(l.tax_amount),
    })),
    payments: [...data.payments].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at)).map((p) => ({
      ...p, amount: money(p.amount), recorder: one(p.recorder),
      review: (() => { const r = one(p.review); return r ? { ...r, reviewer: one(r.reviewer) } : null; })(),
    })),
    credit_notes: [...data.credit_notes].sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((c) => ({ ...c, amount: money(c.amount), creator: one(c.creator) })),
  };
}
export type InvoiceDetail = NonNullable<Awaited<ReturnType<typeof getInvoice>>>;

/** A verified payment with its receipt number, for the printable receipt. */
export async function getReceipt(paymentId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("payments")
    .select(`id, amount, currency, paid_at, method, transaction_reference,
      review:payment_reviews!inner(decision, receipt_number, reviewed_at, reviewer:profiles!payment_reviews_reviewed_by_fkey(full_name)),
      invoice:invoices!payments_invoice_id_fkey(id, invoice_number, total, balance_due, currency,
        client:organizations!invoices_client_id_fkey(legal_name, client_code, billing_address, tax_id, timezone),
        shipment:shipments!invoices_shipment_id_fkey(shipment_reference))`)
    .eq("id", paymentId).eq("review.decision", "verified").maybeSingle();
  if (error) throw new Error("Could not load the receipt");
  const review = one(data?.review);
  const invoice = one(data?.invoice);
  if (!data || !review?.receipt_number || !invoice) return null;
  return {
    ...data, amount: money(data.amount),
    review: { ...review, reviewer: one(review.reviewer) },
    invoice: { ...invoice, total: money(invoice.total), balance_due: money(invoice.balance_due), client: one(invoice.client), shipment: one(invoice.shipment) },
  };
}

/** Shipments an invoice can be prepared for (not closed), most recent first. */
export async function listInvoiceableShipments() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("shipments")
    .select("id, shipment_reference, client:organizations!shipments_client_id_fkey(legal_name, credit_currency)")
    .neq("overall_status", "closed").order("created_at", { ascending: false }).limit(300);
  if (error) throw new Error("Could not load shipments");
  return data.map((s) => ({ ...s, client: one(s.client) }));
}

/** Today's date (YYYY-MM-DD) in a time zone; issue dates are calendar dates in the client's zone. */
export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
