import type { Metadata } from "next";
import { Suspense } from "react";
import { requireClient } from "@/lib/dal/session";
import { listClientInvoices } from "@/lib/dal/client-finance";
import { owedByCurrency } from "@/lib/domain/client-finance";
import { formatAmount } from "@/lib/domain/finance";
import { InvoiceCard } from "@/components/portal/invoice-card";
import { ShipmentListSkeleton } from "@/components/shipments/shipment-list";

export const metadata: Metadata = { title: "Invoices" };

export default function PortalInvoicesPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
      <Suspense fallback={<ShipmentListSkeleton />}>
        <Invoices />
      </Suspense>
    </div>
  );
}

async function Invoices() {
  await requireClient();
  const invoices = await listClientInvoices();
  const owed = owedByCurrency(invoices);
  const open = invoices.filter((i) => i.status !== "paid" && i.status !== "void");
  const settled = invoices.filter((i) => i.status === "paid" || i.status === "void");

  return (
    <>
      {owed.length > 0 ? (
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {owed.map((o) => (
            <div key={o.currency} className="rounded-lg border bg-card p-4">
              <dt className="text-xs text-muted-foreground">To pay ({o.currency}) · {o.count} invoice{o.count === 1 ? "" : "s"}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums break-words">{formatAmount(o.owed, o.currency)}</dd>
              {o.overdue !== "0.00" && <dd className="text-sm text-destructive tabular-nums">Overdue {formatAmount(o.overdue, o.currency)}</dd>}
            </div>
          ))}
        </dl>
      ) : invoices.length > 0 && <p className="rounded-lg border bg-card p-4 text-sm">Nothing to pay. Thank you.</p>}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Open</h2>
        {open.length === 0 ? <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">No open invoices.</p>
          : <ul className="flex flex-col divide-y rounded-lg border bg-card">{open.map((i) => <InvoiceCard key={i.invoice_number} i={i} />)}</ul>}
      </section>
      {settled.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Paid and cancelled</h2>
          <ul className="flex flex-col divide-y rounded-lg border bg-card">{settled.map((i) => <InvoiceCard key={i.invoice_number} i={i} />)}</ul>
        </section>
      )}
    </>
  );
}
