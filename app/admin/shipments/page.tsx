import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus, Search } from "lucide-react";
import { requireStaff } from "@/lib/dal/session";
import { searchShipments } from "@/lib/dal/shipments";
import { listClientOptions } from "@/lib/dal/clients";
import { PageHeader } from "@/components/layout/page-header";
import { ShipmentList, ShipmentListSkeleton } from "@/components/shipments/shipment-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

export const metadata: Metadata = { title: "Shipments" };

export default function ShipmentsPage({ searchParams }: PageProps<"/admin/shipments">) {
  return (
    <Suspense fallback={<ShipmentListSkeleton />}>
      <Shipments searchParams={searchParams} />
    </Suspense>
  );
}

async function Shipments({ searchParams }: Pick<PageProps<"/admin/shipments">, "searchParams">) {
  const user = await requireStaff();
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = first(params.q).slice(0, 60);
  const clientId = /^[0-9a-f-]{36}$/i.test(first(params.client)) ? first(params.client) : "";
  const [shipments, clients] = await Promise.all([
    searchShipments({ q, clientId: clientId || undefined }),
    listClientOptions(),
  ]);
  const canRegister = ["admin", "ops_manager", "doc_officer"].includes(user.role);

  return (
    <>
      <PageHeader
        title="Shipments"
        description={`${shipments.length} shown${q || clientId ? " (filtered)" : ""}`}
        actions={canRegister && (
          <Button asChild><Link href="/admin/shipments/new"><Plus aria-hidden /> Register shipment</Link></Button>
        )}
      />
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_16rem_auto]" role="search">
        <label htmlFor="q" className="sr-only">Search</label>
        <Input id="q" name="q" type="search" defaultValue={q} placeholder="Reference, BL, booking or cargo" />
        <label htmlFor="client" className="sr-only">Client</label>
        <NativeSelect id="client" name="client" defaultValue={clientId}>
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.legal_name}</option>)}
        </NativeSelect>
        <Button type="submit" variant="secondary"><Search aria-hidden /> Search</Button>
      </form>
      <ShipmentList shipments={shipments} showClient linkBase="/admin/shipments" />
    </>
  );
}
