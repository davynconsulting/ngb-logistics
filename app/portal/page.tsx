import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { requireClient } from "@/lib/dal/session";
import { getOrgTimezone, getPortalDashboard } from "@/lib/dal/portal";
import { DOCUMENT_TYPE_LABELS } from "@/lib/domain/documents";
import { formatDate } from "@/lib/format";
import { ShipmentCard } from "@/components/portal/shipment-card";
import { InboxList } from "@/components/portal/inbox-list";
import { ShipmentListSkeleton } from "@/components/shipments/shipment-list";

export const metadata: Metadata = { title: "Overview" };

export default function PortalHomePage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
      <Suspense fallback={<ShipmentListSkeleton />}>
        <Dashboard />
      </Suspense>
    </div>
  );
}

async function Dashboard() {
  const user = await requireClient();
  const [d, tz] = await Promise.all([getPortalDashboard(), getOrgTimezone(user.organizationId)]);
  const inTransit = d.shipments.filter((s) => ["truck_assigned", "loading", "loaded", "in_transit", "arrived"].includes(s.overall_status)).length;
  const tiles = [
    { label: "Active shipments", value: d.shipments.length, href: "/portal/shipments" },
    { label: "On the road", value: inTransit },
    { label: "Need your action", value: d.actions.length, warn: d.actions.length > 0, href: d.actions.length ? "#actions" : undefined },
    { label: "Unread", value: d.unread, href: "/portal/notifications" },
  ];

  return (
    <>
      <p className="-mt-4 text-sm text-muted-foreground">{user.organizationName}</p>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="relative rounded-lg border bg-card p-4">
            <dt className="text-xs text-muted-foreground">
              {t.href ? <Link href={t.href} className="after:absolute after:inset-0">{t.label}</Link> : t.label}
            </dt>
            <dd className={`mt-1 text-2xl font-semibold tabular-nums ${t.warn ? "text-warning-foreground dark:text-warning" : ""}`}>{t.value}</dd>
          </div>
        ))}
      </dl>

      {d.actions.length > 0 && (
        <section id="actions" className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Needs your action</h2>
          <ul className="flex flex-col divide-y rounded-lg border border-warning/50 bg-card">
            {d.actions.map((a) => (
              <li key={a.id}>
                <Link href={`/portal/shipments/${encodeURIComponent(a.shipment.shipment_reference)}#documents`}
                  className="flex items-start gap-3 p-4 hover:bg-muted/50">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground dark:text-warning" aria-hidden />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-medium">
                      {a.status === "rejected" ? "Upload a corrected" : "Upload the"} {DOCUMENT_TYPE_LABELS[a.document_type].toLowerCase()}
                    </span>
                    <span className="text-sm break-words text-muted-foreground">
                      <span className="font-mono">{a.shipment.shipment_reference}</span>
                      {a.client_note && ` · ${a.client_note}`}
                      {a.due_date && ` · by ${formatDate(a.due_date, tz)}`}
                    </span>
                  </span>
                  <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-medium">Active shipments</h2>
          <Link href="/portal/shipments?view=all" className="text-sm text-primary underline-offset-4 hover:underline">All shipments</Link>
        </div>
        {d.shipments.length === 0 ? (
          <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">No active shipments.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {d.shipments.map((s) => <ShipmentCard key={s.id} s={s} timeZone={tz} />)}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-medium">Latest updates</h2>
          <Link href="/portal/notifications" className="text-sm text-primary underline-offset-4 hover:underline">All notifications</Link>
        </div>
        <InboxList items={d.notifications} timeZone={tz} empty="No updates yet." />
      </section>
    </>
  );
}
