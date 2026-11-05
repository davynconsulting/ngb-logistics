import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaff } from "@/lib/dal/session";
import { getStaffOverview, listShipments } from "@/lib/dal/shipments";
import { ROLE_LABELS } from "@/lib/auth/roles";
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
  const [overview, shipments] = await Promise.all([getStaffOverview(), listShipments({ limit: 20 })]);
  const assignedOnly = user.role === "clearing_agent" || user.role === "driver";
  const tiles = [
    { label: assignedOnly ? "Assigned shipments" : "Shipments", value: overview.shipments },
    { label: "Containers", value: overview.containers },
    { label: "Clients", value: overview.clients },
    { label: "Missing required documents", value: overview.missingDocuments, warn: overview.missingDocuments > 0 },
  ];
  return (
    <>
      <p className="-mt-4 text-sm text-muted-foreground">
        Signed in as {ROLE_LABELS[user.role]}
        {assignedOnly && " · you see only shipments assigned to you"}
      </p>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border bg-card p-4">
            <dt className="text-xs text-muted-foreground">{t.label}</dt>
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
