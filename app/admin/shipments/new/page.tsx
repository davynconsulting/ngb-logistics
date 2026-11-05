import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaff } from "@/lib/dal/session";
import { listActiveStaff, listClientOptions, listPorts } from "@/lib/dal/clients";
import { RegisterShipmentForm } from "@/components/shipments/register-form";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Register shipment" };

export default function NewShipmentPage() {
  return (
    <>
      <PageHeader title="Register shipment" back={{ href: "/admin/shipments", label: "Shipments" }}
        description="Shipment, containers and document checklist are saved together." />
      <Suspense>
        <NewShipment />
      </Suspense>
    </>
  );
}

async function NewShipment() {
  const user = await requireStaff("admin", "ops_manager", "doc_officer");
  const [clients, ports, staff] = await Promise.all([listClientOptions(), listPorts(), listActiveStaff()]);
  return (
    <div className="max-w-4xl rounded-lg border bg-card p-4 sm:p-6">
      <RegisterShipmentForm
        currentUserId={user.id}
        clients={clients.map((c) => ({ id: c.id, label: `${c.legal_name} (${c.client_code})` }))}
        ports={ports.map((p) => ({ id: p.id, label: `${p.name} (${p.code})` }))}
        staff={staff.filter((s) => ["admin", "ops_manager", "doc_officer"].includes(s.role))}
      />
    </div>
  );
}
