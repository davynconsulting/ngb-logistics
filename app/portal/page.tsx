import type { Metadata } from "next";
import { Suspense } from "react";
import { requireClient } from "@/lib/dal/session";
import { listShipments } from "@/lib/dal/shipments";
import { ShipmentList, ShipmentListSkeleton } from "@/components/shipments/shipment-list";

export const metadata: Metadata = { title: "My shipments" };

export default function PortalHomePage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">My shipments</h1>
      <Suspense fallback={<ShipmentListSkeleton />}>
        <ClientShipments />
      </Suspense>
    </div>
  );
}

async function ClientShipments() {
  const user = await requireClient();
  const shipments = await listShipments();
  return (
    <>
      <p className="-mt-2 text-sm text-muted-foreground">
        {user.organizationName} · {shipments.length} shipment{shipments.length === 1 ? "" : "s"}
      </p>
      <ShipmentList shipments={shipments} />
    </>
  );
}
