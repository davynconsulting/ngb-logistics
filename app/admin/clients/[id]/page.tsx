import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { UserPlus } from "lucide-react";
import { requireStaff } from "@/lib/dal/session";
import { getClient, listActiveStaff } from "@/lib/dal/clients";
import { listUsers } from "@/lib/dal/users";
import { saveClient } from "@/lib/actions/clients";
import { ClientForm } from "@/components/clients/client-form";
import { PageHeader } from "@/components/layout/page-header";
import { FormAlert } from "@/components/auth/form-alert";
import { UserTable } from "@/components/users/user-table";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Client" };

export default function ClientPage({ params, searchParams }: PageProps<"/admin/clients/[id]">) {
  return (
    <Suspense>
      <ClientDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ClientDetail({ params, searchParams }: PageProps<"/admin/clients/[id]">) {
  const user = await requireStaff("admin", "ops_manager", "doc_officer", "finance");
  const { id } = await params;
  const { created } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [client, staff] = await Promise.all([getClient(id), listActiveStaff()]);
  if (!client) notFound();

  const canEdit = user.role === "admin" || user.role === "ops_manager";
  const users = canEdit ? await listUsers({ organizationId: client.id }) : [];

  return (
    <>
      <PageHeader title={client.legal_name} description={<span className="font-mono">{client.client_code}</span>}
        back={{ href: "/admin/clients", label: "Clients" }} />
      <div className="flex flex-col gap-6">
        {created && <FormAlert kind="success">Client created. Next, invite the client&apos;s users below.</FormAlert>}
        <div className="max-w-3xl rounded-lg border bg-card p-4 sm:p-6">
          <ClientForm mode="edit" canEdit={canEdit} action={saveClient.bind(null, client.id)} staff={staff} defaults={client} />
        </div>
        {canEdit && (
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-medium">Client users</h2>
              <Button asChild variant="outline" size="sm">
                <Link href={`/admin/users/new?role=client&organization_id=${client.id}`}><UserPlus aria-hidden /> Invite user</Link>
              </Button>
            </div>
            <UserTable users={users} currentUserId={user.id} canManageStaff={user.role === "admin"} />
          </section>
        )}
      </div>
    </>
  );
}
