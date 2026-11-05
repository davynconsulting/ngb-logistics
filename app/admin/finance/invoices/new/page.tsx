import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaff } from "@/lib/dal/session";
import { listInvoiceableShipments } from "@/lib/dal/finance";
import { PageHeader } from "@/components/layout/page-header";
import { InvoiceEditor } from "@/components/finance/invoice-editor";

export const metadata: Metadata = { title: "New invoice" };

export default function NewInvoicePage({ searchParams }: PageProps<"/admin/finance/invoices/new">) {
  return (
    <>
      <PageHeader title="New invoice" description="Saved as a draft; it gets its number when issued"
        back={{ href: "/admin/finance", label: "Finance" }} />
      <Suspense>
        <Editor searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Editor({ searchParams }: Pick<PageProps<"/admin/finance/invoices/new">, "searchParams">) {
  await requireStaff("finance", "admin");
  const [sp, shipments] = await Promise.all([searchParams, listInvoiceableShipments()]);
  const wanted = typeof sp.shipment === "string" ? sp.shipment : undefined;
  const options = shipments.map((s) => ({
    id: s.id, label: `${s.shipment_reference} · ${s.client?.legal_name ?? ""}`, currency: s.client?.credit_currency ?? null,
  }));
  return (
    <section className="rounded-lg border bg-card p-4 sm:p-6">
      <InvoiceEditor invoiceId={null} shipments={options} shipmentId={options.some((o) => o.id === wanted) ? wanted : undefined} />
    </section>
  );
}
