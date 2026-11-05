import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import Decimal from "decimal.js";
import { requireStaff } from "@/lib/dal/session";
import { getInvoice, todayIn, type InvoiceDetail } from "@/lib/dal/finance";
import {
  FINANCE_READERS, PAYMENT_METHOD_LABELS, canManageDisputes, canVerifyPayments, canWriteFinance, formatAmount, isOpenInvoice,
} from "@/lib/domain/finance";
import { formatDate, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { InvoiceStatusBadge } from "@/components/finance/invoice-status-badge";
import { InvoiceEditor } from "@/components/finance/invoice-editor";
import { IssueInvoiceForm, ReasonForm, RecordPaymentForm, ReviewPaymentForm } from "@/components/finance/finance-forms";
import { FormAlert } from "@/components/auth/form-alert";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Invoice" };

export default function InvoicePage({ params, searchParams }: PageProps<"/admin/finance/invoices/[id]">) {
  return (
    <Suspense>
      <Invoice params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-4 sm:p-6">
      <h2 className="mb-3 text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}

function Lines({ inv }: { inv: InvoiceDetail }) {
  return (
    <ol className="flex flex-col divide-y text-sm">
      {inv.lines.map((l) => (
        <li key={l.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2">
          <span className="min-w-0 break-words">{l.line_no}. {l.description}</span>
          <span className="text-right tabular-nums">
            {l.quantity} × {formatAmount(l.unit_price, inv.currency)} = <span className="font-medium">{formatAmount(l.amount, inv.currency)}</span>
            <br /><span className="text-xs text-muted-foreground">tax {l.tax_rate}%: {formatAmount(l.tax_amount, inv.currency)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

async function Invoice({ params, searchParams }: PageProps<"/admin/finance/invoices/[id]">) {
  const user = await requireStaff(...FINANCE_READERS);
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const inv = await getInvoice(id);
  if (!inv) notFound();

  const tz = inv.client?.timezone ?? "Africa/Kigali";
  const writer = canWriteFinance(user.role);
  const open = isOpenInvoice(inv.status);
  const pending = inv.payments.filter((p) => !p.review).reduce((s, p) => s.plus(p.amount), new Decimal(0));
  const receivable = Decimal.max(new Decimal(inv.balance_due).minus(pending), 0).toFixed(2);
  const canVoid = writer && inv.status !== "void" && inv.payments.length === 0 && inv.credit_notes.length === 0;
  const amounts: [string, string, string?][] = [
    ["Subtotal", inv.subtotal], ["Tax", inv.tax_total], ["Total", inv.total, "font-semibold"],
    ...(inv.status !== "draft" ? [
      ["Paid (verified)", inv.amount_paid], ["Credited", inv.amount_credited], ["Balance due", inv.balance_due, "font-semibold"],
    ] as [string, string, string?][] : []),
  ];

  return (
    <>
      <PageHeader
        title={<span className="font-mono">{inv.invoice_number ?? "Draft invoice"}</span>}
        description={<>{inv.client?.legal_name} · <Link className="font-mono underline-offset-4 hover:underline" href={`/admin/shipments/${inv.shipment_id}`}>{inv.shipment?.shipment_reference}</Link></>}
        back={{ href: "/admin/finance", label: "Finance" }}
        actions={<InvoiceStatusBadge status={inv.status} />}
      />
      <div className="flex flex-col gap-6">
        {sp.saved && <FormAlert kind="success">Draft saved. Check the lines, then issue it below.</FormAlert>}
        {inv.status === "void" && <FormAlert kind="info">Voided {formatDateTime(inv.voided_at, tz)}: {inv.void_reason}</FormAlert>}
        {inv.disputed_at && <FormAlert kind="error">Disputed since {formatDate(inv.disputed_at, tz)}: {inv.dispute_reason}. Reminders are paused.</FormAlert>}

        <Section title="Summary">
          <div className="grid gap-6 sm:grid-cols-2">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Client</dt><dd className="break-words">{inv.client?.legal_name} ({inv.client?.client_code})</dd>
              <dt className="text-muted-foreground">Currency</dt><dd>{inv.currency}</dd>
              <dt className="text-muted-foreground">Issued</dt><dd>{inv.issue_date ? `${formatDate(inv.issue_date)}${inv.issuer?.full_name ? ` by ${inv.issuer.full_name}` : ""}` : "Not yet"}</dd>
              <dt className="text-muted-foreground">Due</dt><dd>{inv.due_date ? formatDate(inv.due_date) : "—"}</dd>
            </dl>
            <dl className="grid grid-cols-2 gap-1 text-sm tabular-nums sm:ml-auto sm:w-72">
              {amounts.map(([k, v, cls]) => (
                <div key={k} className="contents">
                  <dt className={cls ?? "text-muted-foreground"}>{k}</dt><dd className={`text-right ${cls ?? ""}`}>{formatAmount(v, inv.currency)}</dd>
                </div>
              ))}
              {pending.gt(0) && <><dt className="text-muted-foreground">Awaiting verification</dt><dd className="text-right">{formatAmount(pending.toFixed(2), inv.currency)}</dd></>}
            </dl>
          </div>
        </Section>

        {inv.status === "draft" && writer ? (
          <>
            <Section title="Lines">
              <InvoiceEditor invoiceId={inv.id} shipmentId={inv.shipment_id}
                initial={{ currency: inv.currency, clientNote: inv.client_note, paymentInstructions: inv.payment_instructions,
                  lines: inv.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit_price: l.unit_price, tax_rate: l.tax_rate })) }} />
            </Section>
            <Section title="Issue">
              <IssueInvoiceForm invoiceId={inv.id} today={todayIn(tz)} termsDays={inv.client?.billing_terms_days ?? 30} />
            </Section>
          </>
        ) : (
          <Section title="Lines">
            <Lines inv={inv} />
            {(inv.client_note || inv.payment_instructions) && (
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                {inv.client_note && <p className="whitespace-pre-line"><span className="block text-xs text-muted-foreground">Note to the client</span>{inv.client_note}</p>}
                {inv.payment_instructions && <p className="whitespace-pre-line"><span className="block text-xs text-muted-foreground">Payment instructions</span>{inv.payment_instructions}</p>}
              </div>
            )}
          </Section>
        )}

        {inv.status !== "draft" && (
          <Section title="Payments">
            {inv.payments.length === 0 ? <p className="text-sm text-muted-foreground">No payments recorded.</p> : (
              <ul className="flex flex-col gap-3">
                {inv.payments.map((p) => (
                  <li key={p.id} className="flex flex-col gap-2 rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium tabular-nums">{formatAmount(p.amount, p.currency)}</span>
                      {!p.review ? <Badge variant="secondary" className="bg-warning/25 text-warning-foreground">Awaiting verification</Badge>
                        : p.review.decision === "verified" ? <Badge variant="secondary" className="bg-success/15 text-success">Verified</Badge>
                        : <Badge variant="secondary" className="bg-destructive/10 text-destructive">Rejected</Badge>}
                    </div>
                    <p className="text-muted-foreground">
                      {PAYMENT_METHOD_LABELS[p.method]}{p.transaction_reference ? ` · ref ${p.transaction_reference}` : ""} · received {formatDateTime(p.paid_at, tz)}
                      {" · "}recorded by {p.recorder?.full_name ?? "staff"}
                    </p>
                    {p.note && <p className="break-words">{p.note}</p>}
                    {p.review?.decision === "verified" && (
                      <p>
                        Verified {formatDateTime(p.review.reviewed_at, tz)} by {p.review.reviewer?.full_name ?? "finance"} ·{" "}
                        <Link className="font-mono underline underline-offset-4" href={`/admin/finance/receipts/${p.id}`}>{p.review.receipt_number}</Link>
                      </p>
                    )}
                    {p.review?.decision === "rejected" && <p>Rejected by {p.review.reviewer?.full_name ?? "finance"}: {p.review.reason}</p>}
                    {!p.review && canVerifyPayments(user.role) && inv.status !== "void" && <ReviewPaymentForm paymentId={p.id} />}
                    {!p.review && !canVerifyPayments(user.role) && <p className="text-xs text-muted-foreground">A finance officer verifies this payment.</p>}
                  </li>
                ))}
              </ul>
            )}
            {writer && open && new Decimal(receivable).gt(0) && (
              <div className="mt-4 border-t pt-4">
                <h3 className="mb-3 font-medium">Record a payment</h3>
                <RecordPaymentForm invoiceId={inv.id} currency={inv.currency} max={receivable} />
              </div>
            )}
          </Section>
        )}

        {inv.status !== "draft" && (inv.credit_notes.length > 0 || (writer && open)) && (
          <Section title="Credit notes">
            {inv.credit_notes.length > 0 && (
              <ul className="mb-4 flex flex-col gap-2 text-sm">
                {inv.credit_notes.map((c) => (
                  <li key={c.id} className="rounded-md border p-3">
                    <span className="font-mono">{c.credit_note_number}</span> · <span className="tabular-nums font-medium">{formatAmount(c.amount, inv.currency)}</span>
                    <span className="block text-muted-foreground">{formatDateTime(c.created_at, tz)} by {c.creator?.full_name ?? "finance"}: {c.reason}</span>
                  </li>
                ))}
              </ul>
            )}
            {writer && open && new Decimal(receivable).gt(0) && <ReasonForm kind="credit" invoiceId={inv.id} currency={inv.currency} max={receivable} />}
          </Section>
        )}

        {inv.status !== "draft" && (
          <Section title="Payment reminders">
            {inv.client?.payment_reminders === false && <p className="mb-2 text-sm text-muted-foreground">Reminders are turned off for this client.</p>}
            {inv.disputed_at && <p className="mb-2 text-sm text-muted-foreground">Paused while the invoice is disputed.</p>}
            {inv.reminders.length === 0 ? <p className="text-sm text-muted-foreground">None sent yet.</p> : (
              <ul className="flex flex-col gap-1 text-sm">
                {inv.reminders.map((r) => (
                  <li key={r.id} className="flex flex-wrap justify-between gap-2">
                    <span>{r.days_from_due < 0 ? `Due in ${-r.days_from_due} day${r.days_from_due === -1 ? "" : "s"}` : r.days_from_due === 0 ? "Due today" : `${r.days_from_due} day${r.days_from_due === 1 ? "" : "s"} overdue`}
                      <span className="text-muted-foreground"> · balance {formatAmount(r.balance_due, inv.currency)}</span></span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(r.sent_at, tz)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {open && canManageDisputes(user.role) && (
          <Section title={inv.disputed_at ? "Resolve the dispute" : "Dispute"}>
            <ReasonForm kind="dispute" invoiceId={inv.id} open={!inv.disputed_at} />
          </Section>
        )}

        {canVoid && (
          <Section title="Void">
            <p className="mb-3 text-sm text-muted-foreground">
              {inv.status === "draft" ? "Discard this draft." : "Cancel this invoice. Its number stays used and is shown as void."} Once a payment or credit note exists, use a credit note instead.
            </p>
            <ReasonForm kind="void" invoiceId={inv.id} />
          </Section>
        )}
      </div>
    </>
  );
}
