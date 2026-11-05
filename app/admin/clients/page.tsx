import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { requireStaff } from "@/lib/dal/session";
import { listClients } from "@/lib/dal/clients";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShipmentListSkeleton } from "@/components/shipments/shipment-list";

export const metadata: Metadata = { title: "Clients" };

export default function ClientsPage() {
  return (
    <Suspense fallback={<ShipmentListSkeleton />}>
      <Clients />
    </Suspense>
  );
}

async function Clients() {
  const user = await requireStaff("admin", "ops_manager", "doc_officer", "finance");
  const clients = await listClients();
  const canCreate = user.role === "admin" || user.role === "ops_manager";
  return (
    <>
      <PageHeader
        title="Clients"
        description={`${clients.length} client compan${clients.length === 1 ? "y" : "ies"}`}
        actions={canCreate && (
          <Button asChild><Link href="/admin/clients/new"><Plus aria-hidden /> New client</Link></Button>
        )}
      />
      <ul className="grid gap-3 md:grid-cols-2">
        {clients.map((c) => (
          <li key={c.id}>
            <Link href={`/admin/clients/${c.id}`} className="flex h-full flex-col gap-1 rounded-lg border bg-card p-4 transition-colors hover:border-primary/40">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.legal_name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{c.client_code}</p>
                </div>
                {!c.is_active && <Badge variant="outline">Inactive</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">{c.primary_contact_name} · {c.phone_e164}</p>
              <p className="text-xs text-muted-foreground">
                {c.shipments[0]?.count ?? 0} shipments · {c.users[0]?.count ?? 0} users
                {c.billing_terms_days != null && ` · ${c.billing_terms_days}-day terms`}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
