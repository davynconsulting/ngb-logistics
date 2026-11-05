import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaff } from "@/lib/dal/session";
import { listActiveStaff } from "@/lib/dal/clients";
import { saveClient } from "@/lib/actions/clients";
import { ClientForm } from "@/components/clients/client-form";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "New client" };

export default function NewClientPage() {
  return (
    <>
      <PageHeader title="New client" back={{ href: "/admin/clients", label: "Clients" }} />
      <Suspense>
        <NewClient />
      </Suspense>
    </>
  );
}

async function NewClient() {
  const user = await requireStaff("admin", "ops_manager");
  const staff = await listActiveStaff();
  return (
    <div className="max-w-3xl rounded-lg border bg-card p-4 sm:p-6">
      <ClientForm
        mode="create"
        canEdit
        action={saveClient.bind(null, null)}
        staff={staff}
        defaults={{ preferred_language: "en", timezone: "Africa/Kigali", account_manager_id: user.role === "ops_manager" ? user.id : null }}
      />
    </div>
  );
}
