import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaff } from "@/lib/dal/session";
import { listClientOptions } from "@/lib/dal/clients";
import { APP_ROLES } from "@/lib/auth/roles";
import { InviteForm } from "@/components/users/invite-form";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Invite user" };

export default function InviteUserPage({ searchParams }: PageProps<"/admin/users/new">) {
  return (
    <>
      <PageHeader title="Invite user" back={{ href: "/admin/users", label: "Users" }}
        description="Creates the account and gives you a one-time link to send to the person." />
      <Suspense>
        <Invite searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Invite({ searchParams }: Pick<PageProps<"/admin/users/new">, "searchParams">) {
  const user = await requireStaff("admin", "ops_manager");
  const [clients, params] = await Promise.all([listClientOptions(), searchParams]);
  // Operations managers may invite client users only
  const roles = user.role === "admin" ? [...APP_ROLES] : (["client"] as const).slice();
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const role = first(params.role);
  return (
    <div className="max-w-3xl rounded-lg border bg-card p-4 sm:p-6">
      <InviteForm
        roles={roles}
        clients={clients}
        defaults={{ role: role && (roles as string[]).includes(role) ? role : roles[0], organization_id: first(params.organization_id) }}
      />
    </div>
  );
}
