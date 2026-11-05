import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireClient } from "@/lib/dal/session";
import { getClientInvoice } from "@/lib/dal/client-finance";
import { getOrgTimezone } from "@/lib/dal/portal";
import { PAYMENT_METHOD_LABELS, formatAmount } from "@/lib/domain/finance";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { InvoiceStatusBadge } from "@/components/finance/invoice-status-badge";
import { PrintButton } from "@/components/finance/print-button";
import { FormAlert } from "@/components/auth/form-alert";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Invoice", robots: { index: false } };

export default function PortalInvoicePage({ params }: PageProps<"/portal/invoices/[number]">) {
  return (
    <Suspense fallback={<div className="flex flex-col gap-4"><Skeleton className="h-10 w-56" /><Skeleton className="h-60 w-full" /></div>}>
      <Invoice params={params} />
    </Suspense>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-4 sm:p-6 print:border-0 print:p-0">
      <h2 className="mb-3 text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}

async function Invoice({ params }: Pick<PageProps<"/portal/invoices/[number]">, "params">) {
  const user = await requireClient();
  const { number } = await params;
  // unknown and other clients' numbers look the same
  const [inv, tz] = await Promise.all([getClientInvoice(decodeURIComponent(number)), getOrgTimezone(user.organizationId)]);
  if (!inv) notFound();
  const c = inv.currency;
  const open = inv.status !== "paid" && inv.status !== "void";
  const totals: [string, string, boolean?][] = [
    ["Subtotal", inv.subtotal], ["Tax", inv.tax_total], ["Total", inv.total, true],
    ...(inv.status !== "void" ? [["Paid", inv.amount_paid], ...(inv.amount_credited !== "0.00" ? [["Credited", inv.amount_credited]] : []),
      ["Balance to pay", inv.balance_due, true]] as [string, string, boolean?][] : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader back={{ href: "/portal/invoices", label: "Invoices" }}
        title={<span className="font-mono">{inv.invoice_number}</span>}
        description={<>Shipment <Link href={`/portal/shipments/${encodeURIComponent(inv.shipment_reference)}`} className="font-mono underline-offset-4 hover:underline">{inv.shipment_reference}</Link></>}
        actions={<InvoiceStatusBadge status={inv.status} client />} />

      {inv.status === "overdue" && <FormAlert kind="error">This invoice was due on {formatDate(inv.due_date)}. Please pay the balance or contact NGB finance.</FormAlert>}
      {inv.status === "disputed" && <FormAlert kind="info">NGB finance is reviewing a query on this invoice. Reminders are paused meanwhile.</FormAlert>}
      {inv.status === "void" && <FormAlert kind="info">This invoice was cancelled. Nothing is owed on it.</FormAlert>}
      {inv.awaiting_verification !== "0.00" && open && (
        <FormAlert kind="info">{formatAmount(inv.awaiting_verification, c)} received and being verified by NGB finance.</FormAlert>
      )}

      <Section title="Summary">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm tabular-nums sm:max-w-sm">
          <dt className="text-muted-foreground">Issued</dt><dd className="text-right">{formatDate(inv.issue_date)}</dd>
          <dt className="text-muted-foreground">Due</dt><dd className="text-right">{formatDate(inv.due_date)}</dd>
          {totals.map(([k, v, strong]) => (
            <div key={k} className="contents">
              <dt className={strong ? "font-medium" : "text-muted-foreground"}>{k}</dt>
              <dd className={`text-right break-words ${strong ? "font-semibold" : ""}`}>{formatAmount(v, c)}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {open && inv.payment_instructions && (
        <Section title="How to pay">
          <p className="text-sm break-words whitespace-pre-line">{inv.payment_instructions}</p>
          <p className="mt-2 text-xs text-muted-foreground">Quote {inv.invoice_number} as the payment reference. The balance updates once NGB finance verifies the payment.</p>
        </Section>
      )}

      <Section title="Charges">
        <ol className="flex flex-col divide-y text-sm">
          {inv.lines.map((l) => (
            <li key={l.line_no} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2">
              <span className="min-w-0 break-words">{l.description}</span>
              <span className="text-right tabular-nums">
                {l.quantity} × {formatAmount(l.unit_price, c)} = <span className="font-medium">{formatAmount(l.amount, c)}</span>
                {l.tax_rate !== "0" && <><br /><span className="text-xs text-muted-foreground">tax {l.tax_rate}%: {formatAmount(l.tax_amount, c)}</span></>}
              </span>
            </li>
          ))}
        </ol>
        {inv.client_note && <p className="mt-3 text-sm break-words whitespace-pre-line text-muted-foreground">{inv.client_note}</p>}
      </Section>

      <Section title="Payments">
        {inv.activity.length === 0 ? <p className="text-sm text-muted-foreground">No payments yet.</p> : (
          <ul className="flex flex-col divide-y text-sm">
            {inv.activity.map((a, idx) => (
              <li key={`${a.kind}-${a.number ?? idx}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium tabular-nums">{formatAmount(a.amount, c)}</span>
                  <span className="text-xs break-words text-muted-foreground">
                    {a.kind === "credit_note" ? `Credit note ${a.number}` : `${a.method ? PAYMENT_METHOD_LABELS[a.method] : "Payment"}${a.transaction_reference ? ` · ref ${a.transaction_reference}` : ""}`}
                    {" · "}{formatDate(a.occurred_at, tz)}
                  </span>
                </span>
                {a.kind === "payment" && (a.verified && a.number
                  ? <Link href={`/portal/receipts/${a.number}`} className="text-sm font-medium text-primary underline-offset-4 hover:underline">Receipt {a.number}</Link>
                  : <span className="text-xs text-muted-foreground">Being verified</span>)}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <div className="print:hidden"><PrintButton /></div>
    </div>
  );
}
