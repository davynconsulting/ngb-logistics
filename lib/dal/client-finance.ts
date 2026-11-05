import "server-only";
import { createClient } from "@/lib/supabase/server";
import { moneyText } from "@/lib/domain/finance";

/*
 * Invoices for the client portal, AS THE SIGNED-IN CLIENT, through the
 * client-safe functions of migration 0022 (clients cannot read the finance
 * tables). Only the client's own organization, never drafts, no internal
 * fields. Lookups are by printed number; another client's number and an
 * unknown one both give null. Amounts become 2-decimal strings here.
 */

const INV = /^INV-\d{4}-\d{5,}$/;
const RCPT = /^RCPT-\d{4}-\d{5,}$/;

function toInvoice(r: {
  invoice_number: string; status: import("@/lib/domain/finance").InvoiceStatus; currency: string; issue_date: string;
  due_date: string; subtotal: number; tax_total: number; total: number; amount_paid: number; amount_credited: number;
  balance_due: number; awaiting_verification: number; shipment_reference: string; client_note: string | null;
  payment_instructions: string | null;
}) {
  return {
    ...r,
    subtotal: moneyText(r.subtotal), tax_total: moneyText(r.tax_total), total: moneyText(r.total),
    amount_paid: moneyText(r.amount_paid), amount_credited: moneyText(r.amount_credited),
    balance_due: moneyText(r.balance_due), awaiting_verification: moneyText(r.awaiting_verification),
  };
}

export async function listClientInvoices() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("client_invoices", {});
  if (error) throw new Error("Could not load invoices");
  return data.map(toInvoice);
}
export type ClientInvoice = Awaited<ReturnType<typeof listClientInvoices>>[number];

export async function getClientInvoice(number: string) {
  const n = number.trim().toUpperCase();
  if (!INV.test(n)) return null;
  const supabase = await createClient();
  const [head, lines, activity] = await Promise.all([
    supabase.rpc("client_invoices", { p_invoice_number: n }),
    supabase.rpc("client_invoice_lines", { p_invoice_number: n }),
    supabase.rpc("client_invoice_activity", { p_invoice_number: n }),
  ]);
  if (head.error || lines.error || activity.error) throw new Error("Could not load the invoice");
  if (!head.data[0]) return null;
  return {
    ...toInvoice(head.data[0]),
    lines: lines.data.map((l) => ({
      ...l, quantity: String(l.quantity), tax_rate: String(l.tax_rate),
      unit_price: moneyText(l.unit_price), amount: moneyText(l.amount), tax_amount: moneyText(l.tax_amount),
    })),
    activity: activity.data.map((a) => ({ ...a, kind: a.kind as "payment" | "credit_note", amount: moneyText(a.amount) })),
  };
}
export type ClientInvoiceDetail = NonNullable<Awaited<ReturnType<typeof getClientInvoice>>>;

export async function getClientReceipt(number: string) {
  const n = number.trim().toUpperCase();
  if (!RCPT.test(n)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("client_receipt", { p_receipt_number: n });
  if (error) throw new Error("Could not load the receipt");
  const r = data[0];
  if (!r) return null;
  return { ...r, amount: moneyText(r.amount), invoice_total: moneyText(r.invoice_total), balance_due: moneyText(r.balance_due) };
}
