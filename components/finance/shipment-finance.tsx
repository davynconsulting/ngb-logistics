import Link from "next/link";
import type { InvoiceListItem } from "@/lib/dal/finance";
import { FINANCE_STATUS_LABELS, formatAmount, type FinanceStatus } from "@/lib/domain/finance";
import { formatDate } from "@/lib/format";
import { InvoiceStatusBadge } from "@/components/finance/invoice-status-badge";
import { Button } from "@/components/ui/button";

/** Invoices on a shipment (finance readers only; RLS returns nothing to others). */
export function ShipmentFinance({
  shipmentId, status, invoices, canCreate,
}: { shipmentId: string; status: FinanceStatus; invoices: InvoiceListItem[]; canCreate: boolean }) {
  return (
    <section className="rounded-lg border bg-card p-4 sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium">Finance <span className="text-sm font-normal text-muted-foreground">· {FINANCE_STATUS_LABELS[status]}</span></h2>
        {canCreate && <Button asChild variant="outline" size="sm"><Link href={`/admin/finance/invoices/new?shipment=${shipmentId}`}>New invoice</Link></Button>}
      </div>
      {invoices.length === 0 ? <p className="text-sm text-muted-foreground">No invoices yet.</p> : (
        <ul className="divide-y text-sm">
          {invoices.map((i) => (
            <li key={i.id}>
              <Link href={`/admin/finance/invoices/${i.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:underline">
                <span className="font-mono">{i.invoice_number ?? "Draft"}</span>
                <span className="flex items-center gap-3 tabular-nums">
                  {formatAmount(i.total, i.currency)}
                  {i.due_date && <span className="text-xs text-muted-foreground">due {formatDate(i.due_date)}</span>}
                  <InvoiceStatusBadge status={i.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
