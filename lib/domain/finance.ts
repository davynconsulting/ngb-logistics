import Decimal from "decimal.js";
import type { Currency } from "@/lib/domain/money";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Invoice helpers for the UI. The database (0021) computes and stores the
 * real totals, balances and statuses; these mirror its rounding so the
 * invoice editor can preview totals before saving. Strings in, strings out:
 * never JavaScript floats for money.
 */

export type InvoiceStatus = Database["public"]["Enums"]["invoice_status"];
export type PaymentMethod = Database["public"]["Enums"]["payment_method"];
export type FinanceStatus = Database["public"]["Enums"]["finance_status"];

export const FINANCE_STATUS_LABELS: Record<FinanceStatus, string> = {
  not_invoiced: "Not invoiced",
  invoiced: "Invoiced",
  partially_paid: "Partly paid",
  paid: "Paid",
  overdue: "Overdue",
  disputed: "Disputed",
  credit_approved: "Credit approved",
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  partially_paid: "Partly paid",
  paid: "Paid",
  overdue: "Overdue",
  disputed: "Disputed",
  void: "Void",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: "Bank transfer",
  mobile_money: "Mobile money",
  cash: "Cash",
  card: "Card",
  other: "Other",
};

// Postgres round(numeric, n) rounds half away from zero; amounts here are never negative
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

const PRICE = /^\d{1,12}(\.\d{1,2})?$/;
const QTY = /^\d{1,9}(\.\d{1,3})?$/;
const RATE = /^\d{1,3}(\.\d{1,2})?$/;

export type LineInput = { description: string; quantity: string; unit_price: string; tax_rate: string };
export type LinePreview = { amount: string; tax: string } | { error: string };

/** One line, exactly as the database computes it: round(qty × price, 2), then round(amount × rate / 100, 2). */
export function previewLine(l: LineInput): LinePreview {
  const qty = l.quantity.trim(), price = l.unit_price.trim(), rate = (l.tax_rate.trim() || "0");
  if (!QTY.test(qty) || new D(qty).lte(0)) return { error: "Quantity above 0, up to 3 decimals" };
  if (!PRICE.test(price)) return { error: "Price with up to 2 decimals" };
  if (!RATE.test(rate) || new D(rate).gt(100)) return { error: "Tax rate 0 to 100" };
  const amount = new D(qty).times(price).toDecimalPlaces(2);
  const tax = amount.times(rate).div(100).toDecimalPlaces(2);
  return { amount: amount.toFixed(2), tax: tax.toFixed(2) };
}

/** Sum of the line previews; null if any line is invalid. */
export function previewTotals(lines: readonly LineInput[]): { subtotal: string; tax: string; total: string } | null {
  let sub = new D(0), tax = new D(0);
  for (const l of lines) {
    const p = previewLine(l);
    if ("error" in p) return null;
    sub = sub.plus(p.amount);
    tax = tax.plus(p.tax);
  }
  return { subtotal: sub.toFixed(2), tax: tax.toFixed(2), total: sub.plus(tax).toFixed(2) };
}

/** "1,091.18 USD" style display of a numeric string (no float conversion). */
export function formatAmount(amount: string | number | null | undefined, currency: Currency | string): string {
  const s = amount == null ? "0" : String(amount);
  if (!/^-?\d+(\.\d+)?$/.test(s)) return `${s} ${currency}`;
  const [int, frac = ""] = new D(s).toFixed(2).split(".");
  const sign = int.startsWith("-") ? "-" : "";
  const grouped = int.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}.${frac} ${currency}`;
}

/** Statuses on which money can still be received. */
export function isOpenInvoice(status: InvoiceStatus): boolean {
  return status === "issued" || status === "partially_paid" || status === "overdue" || status === "disputed";
}

/* Who may do what. These mirror the 0021 functions, which remain the authority. */
type Role = Database["public"]["Enums"]["app_role"];
export const FINANCE_READERS = ["finance", "admin", "ops_manager"] as const satisfies readonly Role[];
export const canReadFinance = (r: Role) => (FINANCE_READERS as readonly Role[]).includes(r);
/** Prepare, issue, record payments, credit notes, void. */
export const canWriteFinance = (r: Role) => r === "finance" || r === "admin";
/** Verify or reject payments (AC-12): finance only. */
export const canVerifyPayments = (r: Role) => r === "finance";
export const canManageDisputes = (r: Role) => canReadFinance(r);

export const INVOICE_FILTERS = [
  { value: "open", label: "Open" },
  { value: "overdue", label: "Overdue" },
  { value: "disputed", label: "Disputed" },
  { value: "draft", label: "Drafts" },
  { value: "paid", label: "Paid" },
  { value: "void", label: "Void" },
  { value: "all", label: "All" },
] as const;
export type InvoiceFilter = (typeof INVOICE_FILTERS)[number]["value"];
export function parseInvoiceFilter(v: unknown): InvoiceFilter {
  return INVOICE_FILTERS.find((f) => f.value === v)?.value ?? "open";
}
/** Statuses included by each filter. */
export function filterStatuses(f: InvoiceFilter): InvoiceStatus[] | null {
  switch (f) {
    case "open": return ["issued", "partially_paid", "overdue", "disputed"];
    case "all": return null;
    default: return [f];
  }
}

/** Amount entered in a form: digits with up to 2 decimals, above zero, within numeric(14,2). */
export function isPositiveAmount(v: string): boolean {
  return PRICE.test(v) && new D(v).gt(0);
}

/**
 * numeric(14,2) from PostgREST (a JSON number) → "1234.50". Exact: numeric(14,2)
 * holds at most 10^14 cents, well below 2^53, so the nearest double always
 * prints back to the same 2 decimals. Use only at the data-access boundary.
 */
export function moneyText(v: number | string | null | undefined): string {
  return v == null ? "0.00" : typeof v === "string" ? v : v.toFixed(2);
}

/** Client-facing status words: "disputed" reads as under review, "void" as cancelled. */
export const CLIENT_INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  issued: "Unpaid",
  partially_paid: "Partly paid",
  paid: "Paid",
  overdue: "Overdue",
  disputed: "Under review",
  void: "Cancelled",
};
