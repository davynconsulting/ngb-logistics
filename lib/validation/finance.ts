import { z } from "zod";
import { Constants } from "@/lib/supabase/database.types";
import { CURRENCIES } from "@/lib/domain/money";
import { isPositiveAmount, previewLine } from "@/lib/domain/finance";
import { emptyToUndefined, optionalText } from "@/lib/validation/common";

/* Finance form schemas. Amounts stay strings (never floats); the database re-checks everything. */

const reason = (what: string) =>
  z.string({ error: `Give the reason for ${what}` }).trim().min(3, { error: `Give the reason for ${what} (at least 3 characters)` }).max(1000);

export const lineSchema = z.object({
  description: z.string().trim().min(1, { error: "Enter a description" }).max(300),
  quantity: z.string().trim(),
  unit_price: z.string().trim(),
  tax_rate: z.string().trim().transform((v) => v || "0"),
}).superRefine((l, ctx) => {
  const p = previewLine(l);
  if ("error" in p) ctx.addIssue({ code: "custom", message: p.error });
});

export const invoiceDraftSchema = z.object({
  shipmentId: z.uuid({ error: "Choose the shipment" }),
  currency: z.enum(CURRENCIES, { error: "Choose the currency" }),
  lines: z.array(lineSchema).min(1, { error: "Add at least one line" }).max(50, { error: "At most 50 lines" }),
  clientNote: optionalText(2000),
  paymentInstructions: optionalText(2000),
});

const isoDate = z.preprocess(emptyToUndefined, z.iso.date({ error: "Enter a valid date" }).optional());
export const issueInvoiceSchema = z.object({ issueDate: isoDate, dueDate: isoDate })
  .refine((v) => !v.issueDate || !v.dueDate || v.dueDate >= v.issueDate, { message: "The due date must be on or after the issue date", path: ["dueDate"] });

const amount = z.string({ error: "Enter the amount" }).trim()
  .refine(isPositiveAmount, { error: "Enter an amount above zero with at most 2 decimals, e.g. 1250.50" });

export const recordPaymentSchema = z.object({
  amount,
  paidAt: z.iso.datetime({ offset: true, error: "Enter when the payment was received" }),
  method: z.enum(Constants.public.Enums.payment_method, { error: "Choose the payment method" }),
  reference: optionalText(100),
  note: optionalText(1000),
}).refine((v) => v.method === "cash" || !!v.reference, { message: "Enter the transaction reference", path: ["reference"] });

export const reviewPaymentSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("verified"), reason: optionalText(1000) }),
  z.object({ decision: z.literal("rejected"), reason: reason("rejecting the payment") }),
], { error: "Choose verify or reject" });

export const creditNoteSchema = z.object({ amount, reason: reason("the credit") });
export const voidInvoiceSchema = z.object({ reason: reason("voiding") });
export const disputeSchema = z.object({ open: z.boolean(), reason: reason("this change") });
