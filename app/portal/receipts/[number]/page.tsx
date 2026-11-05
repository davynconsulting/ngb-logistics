import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireClient } from "@/lib/dal/session";
import { getClientReceipt } from "@/lib/dal/client-finance";
import { getOrgTimezone } from "@/lib/dal/portal";
import { PAYMENT_METHOD_LABELS, formatAmount } from "@/lib/domain/finance";
import { formatDate, formatDateTime } from "@/lib/format";
import { PrintButton } from "@/components/finance/print-button";

export const metadata: Metadata = { title: "Receipt", robots: { index: false } };

export default function PortalReceiptPage({ params }: PageProps<"/portal/receipts/[number]">) {
  return (
    <Suspense>
      <Receipt params={params} />
    </Suspense>
  );
}

/** Printable receipt for one of the client's verified payments. */
async function Receipt({ params }: Pick<PageProps<"/portal/receipts/[number]">, "params">) {
  const user = await requireClient();
  const { number } = await params;
  const [r, tz] = await Promise.all([getClientReceipt(decodeURIComponent(number)), getOrgTimezone(user.organizationId)]);
  if (!r) notFound();
  const rows: [string, React.ReactNode][] = [
    ["Received from", <>{r.client_name}{r.client_tax_id ? <> · TIN {r.client_tax_id}</> : null}</>],
    ["For invoice", <span key="i" className="font-mono">{r.invoice_number}</span>],
    ["Shipment", <span key="s" className="font-mono">{r.shipment_reference}</span>],
    ["Payment date", formatDateTime(r.paid_at, tz)],
    ["Method", `${PAYMENT_METHOD_LABELS[r.method]}${r.transaction_reference ? ` · ref ${r.transaction_reference}` : ""}`],
    ["Verified", formatDate(r.verified_at, tz)],
    ["Invoice total", formatAmount(r.invoice_total, r.currency)],
    ["Balance now", formatAmount(r.balance_due, r.currency)],
  ];
  return (
    <article className="mx-auto w-full max-w-2xl rounded-lg border bg-card p-5 sm:p-10 print:border-0 print:p-0">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xl font-bold tracking-tight">NGB LOGISTICS</p>
          <p className="text-sm text-muted-foreground">Payment receipt</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-semibold">{r.receipt_number}</p>
          <PrintButton />
        </div>
      </header>
      <p className="mb-6 text-3xl font-semibold tabular-nums break-words">{formatAmount(r.amount, r.currency)}</p>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt><dd className="break-words">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-10 text-xs text-muted-foreground">This receipt confirms a payment verified by NGB LOGISTICS finance. Amounts in {r.currency}.</p>
    </article>
  );
}
