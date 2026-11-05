import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireStaff } from "@/lib/dal/session";
import { getReceipt } from "@/lib/dal/finance";
import { FINANCE_READERS, PAYMENT_METHOD_LABELS, formatAmount } from "@/lib/domain/finance";
import { formatDate, formatDateTime } from "@/lib/format";
import { PrintButton } from "@/components/finance/print-button";

export const metadata: Metadata = { title: "Receipt" };

export default function ReceiptPage({ params }: PageProps<"/admin/finance/receipts/[paymentId]">) {
  return (
    <Suspense>
      <Receipt params={params} />
    </Suspense>
  );
}

/** Printable receipt for a VERIFIED payment (use the browser's "Save as PDF"). */
async function Receipt({ params }: Pick<PageProps<"/admin/finance/receipts/[paymentId]">, "params">) {
  await requireStaff(...FINANCE_READERS);
  const { paymentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) notFound();
  const r = await getReceipt(paymentId);
  if (!r) notFound();
  const tz = r.invoice.client?.timezone ?? "Africa/Kigali";
  const rows: [string, React.ReactNode][] = [
    ["Received from", <>{r.invoice.client?.legal_name}{r.invoice.client?.tax_id ? <> · TIN {r.invoice.client.tax_id}</> : null}</>],
    ["For invoice", <span key="i" className="font-mono">{r.invoice.invoice_number}</span>],
    ["Shipment", <span key="s" className="font-mono">{r.invoice.shipment?.shipment_reference}</span>],
    ["Payment date", formatDateTime(r.paid_at, tz)],
    ["Method", `${PAYMENT_METHOD_LABELS[r.method]}${r.transaction_reference ? ` · ref ${r.transaction_reference}` : ""}`],
    ["Verified", `${formatDate(r.review.reviewed_at, tz)}${r.review.reviewer?.full_name ? ` by ${r.review.reviewer.full_name}` : ""}`],
    ["Invoice total", formatAmount(r.invoice.total, r.invoice.currency)],
    ["Balance after payments", formatAmount(r.invoice.balance_due, r.invoice.currency)],
  ];
  return (
    <article className="mx-auto max-w-2xl rounded-lg border bg-card p-6 sm:p-10 print:border-0 print:p-0">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xl font-bold tracking-tight">NGB LOGISTICS</p>
          <p className="text-sm text-muted-foreground">Payment receipt</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-semibold">{r.review.receipt_number}</p>
          <PrintButton />
        </div>
      </header>
      <p className="mb-6 text-3xl font-semibold tabular-nums">{formatAmount(r.amount, r.currency)}</p>
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
