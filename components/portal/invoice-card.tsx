import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ClientInvoice } from "@/lib/dal/client-finance";
import { formatAmount } from "@/lib/domain/finance";
import { formatDate } from "@/lib/format";
import { InvoiceStatusBadge } from "@/components/finance/invoice-status-badge";

export function InvoiceCard({ i }: { i: ClientInvoice }) {
  const open = i.status !== "paid" && i.status !== "void";
  return (
    <li>
      <Link href={`/portal/invoices/${i.invoice_number}`} className="flex items-center gap-3 p-4 hover:bg-muted/50">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-medium">{i.invoice_number}</span>
            <InvoiceStatusBadge status={i.status} client />
          </span>
          <span className="text-sm text-muted-foreground">
            <span className="font-mono">{i.shipment_reference}</span> · due {formatDate(i.due_date)}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end text-sm tabular-nums">
          <span className="font-medium">{formatAmount(open ? i.balance_due : i.total, i.currency)}</span>
          <span className="text-xs text-muted-foreground">{open ? "to pay" : "total"}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}
