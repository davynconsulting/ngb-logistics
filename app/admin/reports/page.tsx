import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireStaff } from "@/lib/dal/session";
import { getOpsReports, getOverdueInvoices, type OpsReports, type OverdueRow } from "@/lib/dal/reports";
import { REPORT_PERIODS, REPORT_ROLES, canSeeOpsReports, formatHours, parsePeriod, percent } from "@/lib/domain/reports";
import { formatAmount } from "@/lib/domain/finance";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  return (
    <Suspense>
      <Reports searchParams={searchParams} />
    </Suspense>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-4 sm:p-6" aria-label={title}>
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="mb-3 text-sm text-muted-foreground">{description}</p>
      {children}
    </section>
  );
}

/** Wide tables scroll inside their card, never the page (AC-17). */
function Table({ head, rows, empty, label }: { head: string[]; rows: React.ReactNode[][]; empty: string; label: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="-mx-4 overflow-x-auto px-4 focus-visible:outline-2 focus-visible:outline-ring sm:mx-0 sm:px-0"
      tabIndex={0} role="region" aria-label={`${label} (scrolls sideways)`}>
      <table className="w-full min-w-[36rem] text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            {head.map((h, i) => <th key={h} scope="col" className={cn("py-2 pr-3 font-medium", i > 0 && "text-right")}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b last:border-0">
              {r.map((c, j) => <td key={j} className={cn("py-2 pr-3 align-top", j > 0 && "text-right tabular-nums")}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Reports({ searchParams }: Pick<PageProps<"/admin/reports">, "searchParams">) {
  const user = await requireStaff(...REPORT_ROLES);
  const days = parsePeriod((await searchParams).period);
  const ops = canSeeOpsReports(user.role);
  const [reports, overdue] = await Promise.all([ops ? getOpsReports(days) : Promise.resolve(null), getOverdueInvoices()]);

  return (
    <>
      <PageHeader title="Reports" description="Port dwell, transit, delivery performance and overdue invoices" />
      <div className="flex flex-col gap-5">
        {reports && (
          <>
            <nav aria-label="Report period" className="flex flex-wrap gap-2">
              {REPORT_PERIODS.map((p) => (
                <Link key={p.days} href={`/admin/reports?period=${p.days}`} aria-current={p.days === days ? "page" : undefined}
                  className={cn("rounded-full border px-3 py-1 text-sm", p.days === days ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
                  {p.label}
                </Link>
              ))}
            </nav>
            <OpsSections r={reports} />
          </>
        )}
        <OverdueSection rows={overdue} />
      </div>
    </>
  );
}

function OpsSections({ r }: { r: OpsReports }) {
  const legHead = ["", "Containers", "Average", "Median", "90th percentile", "Longest", "Estimate", "Within estimate"];
  const leg = (name: React.ReactNode, x: OpsReports["dwell"][number] | OpsReports["transit"][number]) => [
    name, x.containers, formatHours(x.avg_hours), formatHours(x.median_hours), formatHours(x.p90_hours), formatHours(x.max_hours),
    formatHours(x.estimate_hours), `${percent(x.within_estimate, x.containers)} (${x.within_estimate})`,
  ];
  return (
    <>
      <Section title="Port dwell time" description="Discharge to gate-out, for containers that left the port in the period. Estimate: port processing + dispatch allowance.">
        <Table label="Port dwell time" head={["Port", ...legHead.slice(1)]} empty="No container left the port in this period."
          rows={r.dwell.map((x) => leg(x.port_name, x))} />
      </Section>
      <Section title="Transit duration" description="Gate-out to delivery, for containers delivered in the period, against the route estimate.">
        <Table label="Transit duration" head={["Route", ...legHead.slice(1)]} empty="No container was delivered in this period."
          rows={r.transit.map((x) => leg(x.route_name, x))} />
      </Section>
      <Section title="Delivery performance" description="On time = delivered by the ETA given when the container left the port (with the ETA tolerance). Returns = empty container back by its deadline.">
        <Table label="Delivery performance" head={["Client", "Delivered", "On time", "Late", "Average delay", "Returned", "Returned in time", "Return overdue now"]}
          empty="No deliveries or returns in this period."
          rows={r.delivery.map((x) => [
            <Link key="c" href={`/admin/clients/${x.client_id}`} className="underline-offset-4 hover:underline">{x.client_name}</Link>,
            x.delivered, `${percent(x.on_time, x.delivered)} (${x.on_time})`, x.late, formatHours(x.avg_late_hours),
            x.returned, `${percent(x.returned_on_time, x.returned)} (${x.returned_on_time})`,
            x.return_overdue_now > 0 ? <span key="o" className="font-medium text-destructive">{x.return_overdue_now}</span> : 0,
          ])} />
      </Section>
    </>
  );
}

function OverdueSection({ rows }: { rows: OverdueRow[] }) {
  return (
    <Section title="Overdue invoices" description="Unpaid balances past their due date (client's time zone), by days overdue. Never added across currencies.">
      <Table label="Overdue invoices" head={["Client", "Invoices", "1–30 days", "31–60 days", "61–90 days", "Over 90 days", "Total overdue", "Oldest due"]}
        empty="No overdue invoices."
        rows={rows.map((x) => [
          <span key="c"><Link href="/admin/finance?filter=overdue" className="underline-offset-4 hover:underline">{x.client_name}</Link>
            {x.disputed > 0 && <span className="block text-xs text-muted-foreground">{x.disputed} disputed</span>}</span>,
          x.invoices, formatAmount(x.days_1_30, x.currency), formatAmount(x.days_31_60, x.currency), formatAmount(x.days_61_90, x.currency),
          formatAmount(x.days_over_90, x.currency), <strong key="t">{formatAmount(x.total_overdue, x.currency)}</strong>, formatDate(x.oldest_due_date),
        ])} />
    </Section>
  );
}
