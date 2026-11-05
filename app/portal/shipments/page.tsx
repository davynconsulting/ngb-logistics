import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireClient } from "@/lib/dal/session";
import { getOrgTimezone, listClientShipments } from "@/lib/dal/portal";
import { PageHeader } from "@/components/layout/page-header";
import { ShipmentCard } from "@/components/portal/shipment-card";
import { ShipmentListSkeleton } from "@/components/shipments/shipment-list";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Shipments" };

const VIEWS = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "all", label: "All" },
] as const;
type View = (typeof VIEWS)[number]["value"];

export default function ShipmentsPage({ searchParams }: PageProps<"/portal/shipments">) {
  return (
    <>
      <PageHeader title="Shipments" />
      <Suspense fallback={<ShipmentListSkeleton />}>
        <List searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function List({ searchParams }: Pick<PageProps<"/portal/shipments">, "searchParams">) {
  const user = await requireClient();
  const sp = await searchParams;
  const view: View = VIEWS.some((v) => v.value === sp.view) ? (sp.view as View) : "active";
  const [rows, tz] = await Promise.all([listClientShipments(view), getOrgTimezone(user.organizationId)]);
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Filter" className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Link key={v.value} href={v.value === "active" ? "/portal/shipments" : `/portal/shipments?view=${v.value}`}
            aria-current={view === v.value ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1 text-sm", view === v.value ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>
            {v.label}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">No shipments here.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((s) => <ShipmentCard key={s.id} s={s} timeZone={tz} />)}
        </ul>
      )}
    </div>
  );
}
