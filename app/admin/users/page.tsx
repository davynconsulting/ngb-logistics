import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { UserPlus } from "lucide-react";
import { requireStaff } from "@/lib/dal/session";
import { listUsers } from "@/lib/dal/users";
import { PageHeader } from "@/components/layout/page-header";
import { UserTable } from "@/components/users/user-table";
import { Button } from "@/components/ui/button";
import { ShipmentListSkeleton } from "@/components/shipments/shipment-list";

export const metadata: Metadata = { title: "Users" };

export default function UsersPage() {
  return (
    <Suspense fallback={<ShipmentListSkeleton />}>
      <Users />
    </Suspense>
  );
}

async function Users() {
  const user = await requireStaff("admin", "ops_manager");
  const users = await listUsers();
  const staff = users.filter((u) => u.role !== "client");
  const clients = users.filter((u) => u.role === "client");
  return (
    <>
      <PageHeader
        title="Users"
        description={`${staff.length} NGB staff · ${clients.length} client users`}
        actions={<Button asChild><Link href="/admin/users/new"><UserPlus aria-hidden /> Invite user</Link></Button>}
      />
      <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">NGB staff</h2>
          <UserTable users={staff} currentUserId={user.id} canManageStaff={user.role === "admin"} />
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Client users</h2>
          <UserTable users={clients} currentUserId={user.id} canManageStaff={user.role === "admin"} />
        </section>
      </div>
    </>
  );
}
