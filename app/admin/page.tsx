import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaff } from "@/lib/dal/session";
import { getStaffOverview, listShipments } from "@/lib/dal/shipments";
import Link from "next/link";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { countOpenExceptions } from "@/lib/dal/operations";
import { ShipmentList, ShipmentListSkeleton } from "@/components/shipments/shipment-list";

export const metadata: Metadata = { title: "Operations" };

export default function AdminHomePage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Operations overview</h1>
      <Suspense fallback={<ShipmentListSkeleton />}>
        <StaffOverview />
      </Suspense>
    </div>
  );
}

async function StaffOverview() {
  const user = await requireStaff();
  const [overview, shipments, exceptions] = await Promise.all([
    getStaffOverview(), listShipments({ limit: 20 }),
    user.role === "driver" ? Promise.resolve(null) : countOpenExceptions(),
  ]);
  const assignedOnly = user.role === "clearing_agent" || user.role === "driver";
  const tiles = [
    { label: assignedOnly ? "Assigned shipments" : "Shipments", value: overview.shipments },
    { label: "Containers", value: overview.containers },
    { label: "Clients", value: overview.clients },
    { label: "Missing required documents", value: overview.missingDocuments, warn: overview.missingDocuments > 0 },
    ...(exceptions ? [
      { label: "Open exceptions", value: exceptions.open, warn: exceptions.open > 0, href: "/admin/exceptions" },
      { label: "Escalated", value: exceptions.escalated, warn: exceptions.escalated > 0, href: "/admin/exceptions?filter=escalated" },
    ] : []),
  ] as { label: string; value: number; warn?: boolean; href?: string }[];
  return (
    <>
      <p className="-mt-4 text-sm text-muted-foreground">
        Signed in as {ROLE_LABELS[user.role]}
        {assignedOnly && " · you see only shipments assigned to you"}
      </p>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border bg-card p-4">
            <dt className="text-xs text-muted-foreground">
              {t.href ? <Link href={t.href} className="underline-offset-4 hover:underline">{t.label}</Link> : t.label}
            </dt>
            <dd className={`mt-1 text-2xl font-semibold tabular-nums ${t.warn ? "text-warning-foreground dark:text-warning" : ""}`}>
              {t.value}
            </dd>
          </div>
        ))}
      </dl>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Recent shipments</h2>
        <ShipmentList shipments={shipments} showClient linkBase="/admin/shipments" />
      </section>
    </>
  );
}
