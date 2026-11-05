import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import Decimal from "decimal.js";
import { requireStaff } from "@/lib/dal/session";
import { getReceivables, listInvoices } from "@/lib/dal/finance";
import { FINANCE_READERS, INVOICE_FILTERS, canWriteFinance, formatAmount, parseInvoiceFilter } from "@/lib/domain/finance";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { InvoiceStatusBadge } from "@/components/finance/invoice-status-badge";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/auth/form-alert";
import { runFinanceReminders } from "@/lib/actions/finance";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Finance" };

export default function FinancePage({ searchParams }: PageProps<"/admin/finance">) {
  return (
    <Suspense>
      <Invoices searchParams={searchParams} />
    </Suspense>
  );
}

async function Invoices({ searchParams }: Pick<PageProps<"/admin/finance">, "searchParams">) {
  const user = await requireStaff(...FINANCE_READERS);
  const sp = await searchParams;
  const filter = parseInvoiceFilter(sp.filter);
  const q = typeof sp.q === "string" ? sp.q.slice(0, 40) : "";
  const [invoices, open] = await Promise.all([listInvoices({ filter, q }), getReceivables()]);
  const run = typeof sp.reminders === "string" ? sp.reminders : undefined;
  const [overdueN, remindersN] = run && run !== "failed" ? run.split("-").map(Number) : [];

  // Owed per currency, never summed across currencies
  const owed = new Map<string, { total: Decimal; overdue: Decimal; count: number }>();
  for (const r of open) {
    const o = owed.get(r.currency) ?? { total: new Decimal(0), overdue: new Decimal(0), count: 0 };
    o.total = o.total.plus(r.balance_due);
    if (r.status === "overdue") o.overdue = o.overdue.plus(r.balance_due);
    o.count++;
    owed.set(r.currency, o);
  }

  return (
    <>
      <PageHeader title="Finance" description="Invoices, payments and balances"
        actions={canWriteFinance(user.role) && (
          <>
            <form action={runFinanceReminders}><Button type="submit" variant="outline">Send reminders now</Button></form>
            <Button asChild><Link href="/admin/finance/invoices/new">New invoice</Link></Button>
          </>
        )} />
      <div className="flex flex-col gap-4">
        {run === "failed" && <FormAlert kind="error">Reminders could not run. Please try again.</FormAlert>}
        {run && run !== "failed" && (
          <FormAlert kind="success">
            Done: {remindersN} reminder{remindersN === 1 ? "" : "s"} sent, {overdueN} invoice{overdueN === 1 ? "" : "s"} checked for overdue.
            Reminders also run automatically every morning; each stage is sent once.
          </FormAlert>
        )}
        {owed.size > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Outstanding by currency">
            {[...owed].sort(([a], [b]) => a.localeCompare(b)).map(([c, o]) => (
              <li key={c} className="rounded-lg border bg-card p-4">
                <p className="text-xs text-muted-foreground">Outstanding {c} · {o.count} invoice{o.count === 1 ? "" : "s"}</p>
                <p className="text-lg font-semibold tabular-nums">{formatAmount(o.total.toFixed(2), c)}</p>
                {o.overdue.gt(0) && <p className="text-sm text-destructive tabular-nums">Overdue {formatAmount(o.overdue.toFixed(2), c)}</p>}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Filter" className="flex flex-wrap gap-2">
            {INVOICE_FILTERS.map((f) => (
              <Link key={f.value} href={f.value === "open" ? "/admin/finance" : `/admin/finance?filter=${f.value}`}
                aria-current={filter === f.value ? "page" : undefined}
                className={cn("rounded-full border px-3 py-1 text-sm", filter === f.value ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
                {f.label}
              </Link>
            ))}
          </nav>
          <form className="flex gap-2" role="search">
            {filter !== "open" && <input type="hidden" name="filter" value={filter} />}
            <Input name="q" defaultValue={q} placeholder="INV-2026-…" aria-label="Invoice number" className="w-40" />
            <Button type="submit" variant="outline">Search</Button>
          </form>
        </div>

        {invoices.length === 0 ? (
          <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">No invoices here.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border bg-card">
            {invoices.map((i) => (
              <li key={i.id}>
                <Link href={`/admin/finance/invoices/${i.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-4 hover:bg-muted/50">
                  <span className="flex min-w-0 flex-col">
                    <span className="font-mono font-medium">{i.invoice_number ?? "Draft"}</span>
                    <span className="truncate text-sm text-muted-foreground">
                      {i.client?.legal_name} · <span className="font-mono">{i.shipment?.shipment_reference}</span>
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="flex flex-col items-end tabular-nums">
                      <span className="font-medium">{formatAmount(i.total, i.currency)}</span>
                      {i.status !== "draft" && i.status !== "void" && i.balance_due !== i.total &&
                        <span className="text-xs text-muted-foreground">owes {formatAmount(i.balance_due, i.currency)}</span>}
                    </span>
                    {i.due_date && <span className="text-xs text-muted-foreground">due {formatDate(i.due_date)}</span>}
                    <InvoiceStatusBadge status={i.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
