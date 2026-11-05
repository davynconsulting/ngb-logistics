"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/dal/session";
import { createClient } from "@/lib/supabase/server";
import { FINANCE_READERS } from "@/lib/domain/finance";
import {
  creditNoteSchema, disputeSchema, invoiceDraftSchema, issueInvoiceSchema, recordPaymentSchema,
  reviewPaymentSchema, voidInvoiceSchema,
} from "@/lib/validation/finance";
import { fieldErrors, type ActionState } from "@/lib/validation/common";

/*
 * Finance actions (Sprint 4). Each one checks the role, validates the form and
 * calls the 0021 database function as the signed-in user. The functions check
 * the role again, lock the invoice and apply every money rule; they are the
 * authority. Amounts are sent as decimal STRINGS, never JS numbers.
 */

export type FinanceState = ActionState;

const text = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};
/** Messages raised by our database functions are written for users; others are not shown. */
function dbError(error: { code?: string; message: string }, fallback: string) {
  return ["55000", "22023", "42501", "P0002"].includes(error.code ?? "") ? error.message : fallback;
}
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
/** Generated types say number for numeric; we pass the exact decimal string (PostgREST casts it). */
const numeric = (v: string) => v as unknown as number;
const WRITERS = ["finance", "admin"] as const;

/** Create (invoiceId null) or replace a draft. Lines arrive as JSON in the "lines" field. */
export async function saveInvoiceDraft(invoiceId: string | null, _prev: FinanceState, fd: FormData): Promise<FinanceState> {
  await requireStaff(...WRITERS);
  if (invoiceId !== null && !isUuid(invoiceId)) return { error: "Invoice not found" };
  let lines: unknown;
  try { lines = JSON.parse(text(fd, "lines") ?? "[]"); } catch { lines = null; }
  const parsed = invoiceDraftSchema.safeParse({
    shipmentId: text(fd, "shipment_id"), currency: text(fd, "currency"), lines,
    clientNote: text(fd, "client_note"), paymentInstructions: text(fd, "payment_instructions"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_invoice_draft", {
    p_invoice_id: invoiceId as string, p_shipment_id: v.shipmentId, p_currency: v.currency,
    p_lines: v.lines, p_client_note: v.clientNote, p_payment_instructions: v.paymentInstructions,
  });
  if (error) return { error: dbError(error, "The draft could not be saved. Please try again.") };
  if (invoiceId === null) redirect(`/admin/finance/invoices/${data}?saved=1`);
  refresh();
  return { ok: true, message: "Draft saved." };
}

export async function issueInvoice(invoiceId: string, _prev: FinanceState, fd: FormData): Promise<FinanceState> {
  await requireStaff(...WRITERS);
  const parsed = issueInvoiceSchema.safeParse({ issueDate: text(fd, "issue_date"), dueDate: text(fd, "due_date") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_invoice", {
    p_invoice_id: invoiceId, p_issue_date: parsed.data.issueDate, p_due_date: parsed.data.dueDate,
  });
  if (error) return { error: dbError(error, "The invoice could not be issued. Please try again.") };
  refresh();
  return { ok: true, message: `Invoice ${data} issued.` };
}

export async function recordPayment(invoiceId: string, currency: string, _prev: FinanceState, fd: FormData): Promise<FinanceState> {
  await requireStaff(...WRITERS);
  const parsed = recordPaymentSchema.safeParse({
    amount: text(fd, "amount"), paidAt: text(fd, "paid_at"), method: text(fd, "method"),
    reference: text(fd, "reference"), note: text(fd, "note"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_payment", {
    p_invoice_id: invoiceId, p_amount: numeric(v.amount), p_currency: currency, p_paid_at: v.paidAt,
    p_method: v.method, p_reference: v.reference, p_note: v.note,
  });
  if (error) return { error: dbError(error, "The payment could not be recorded. Please try again.") };
  refresh();
  return { ok: true, message: `Payment of ${v.amount} ${currency} recorded. It counts once finance verifies it.` };
}

export async function reviewPayment(paymentId: string, _prev: FinanceState, fd: FormData): Promise<FinanceState> {
  await requireStaff("finance");
  const parsed = reviewPaymentSchema.safeParse({ decision: text(fd, "decision"), reason: text(fd, "reason") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_payment", {
    p_payment_id: paymentId, p_decision: parsed.data.decision, p_reason: parsed.data.reason,
  });
  if (error) return { error: dbError(error, "The payment could not be reviewed. Please try again.") };
  refresh();
  return { ok: true, message: parsed.data.decision === "verified" ? `Payment verified. Receipt ${data}.` : "Payment rejected." };
}

export async function issueCreditNote(invoiceId: string, currency: string, _prev: FinanceState, fd: FormData): Promise<FinanceState> {
  await requireStaff(...WRITERS);
  const parsed = creditNoteSchema.safeParse({ amount: text(fd, "amount"), reason: text(fd, "reason") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_credit_note", {
    p_invoice_id: invoiceId, p_amount: numeric(parsed.data.amount), p_currency: currency, p_reason: parsed.data.reason,
  });
  if (error) return { error: dbError(error, "The credit note could not be issued. Please try again.") };
  refresh();
  return { ok: true, message: `Credit note ${data} issued.` };
}

export async function voidInvoice(invoiceId: string, _prev: FinanceState, fd: FormData): Promise<FinanceState> {
  await requireStaff(...WRITERS);
  const parsed = voidInvoiceSchema.safeParse({ reason: text(fd, "reason") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_invoice", { p_invoice_id: invoiceId, p_reason: parsed.data.reason });
  if (error) return { error: dbError(error, "The invoice could not be voided. Please try again.") };
  refresh();
  return { ok: true, message: "Invoice voided." };
}

/** Run the daily overdue refresh and reminders now (same function as the schedule). */
export async function runFinanceReminders(): Promise<void> {
  await requireStaff(...WRITERS);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("run_finance_reminders");
  if (error) redirect("/admin/finance?reminders=failed");
  const r = data?.[0];
  redirect(`/admin/finance?reminders=${r?.overdue ?? 0}-${r?.reminders ?? 0}`);
}

export async function setInvoiceDispute(invoiceId: string, open: boolean, _prev: FinanceState, fd: FormData): Promise<FinanceState> {
  await requireStaff(...FINANCE_READERS);
  const parsed = disputeSchema.safeParse({ open, reason: text(fd, "reason") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_invoice_dispute", {
    p_invoice_id: invoiceId, p_open: parsed.data.open, p_reason: parsed.data.reason,
  });
  if (error) return { error: dbError(error, "The dispute could not be updated. Please try again.") };
  refresh();
  return { ok: true, message: open ? "Dispute opened. Reminders pause until it is resolved." : "Dispute resolved." };
}
