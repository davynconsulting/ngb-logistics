import Decimal from "decimal.js";
import type { InvoiceStatus } from "@/lib/domain/finance";

/** Amount still to pay per currency over open invoices (never summed across currencies). */
export function owedByCurrency(invoices: readonly { status: InvoiceStatus; currency: string; balance_due: string }[]) {
  const out = new Map<string, { owed: Decimal; overdue: Decimal; count: number }>();
  for (const i of invoices) {
    if (i.status === "paid" || i.status === "void" || i.status === "draft") continue;
    const o = out.get(i.currency) ?? { owed: new Decimal(0), overdue: new Decimal(0), count: 0 };
    o.owed = o.owed.plus(i.balance_due);
    if (i.status === "overdue") o.overdue = o.overdue.plus(i.balance_due);
    o.count++;
    out.set(i.currency, o);
  }
  return [...out].sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, o]) => ({ currency, owed: o.owed.toFixed(2), overdue: o.overdue.toFixed(2), count: o.count }));
}
