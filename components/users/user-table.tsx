import { setUserActive } from "@/lib/actions/users";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { formatDate } from "@/lib/format";
import type { UserRow } from "@/lib/dal/users";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** User list as cards (phone) / rows (desktop), with activate/deactivate controls. */
export function UserTable({
  users, currentUserId, canManageStaff,
}: { users: UserRow[]; currentUserId: string; canManageStaff: boolean }) {
  if (users.length === 0) {
    return <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">No users yet.</p>;
  }
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {users.map((u) => {
        const canManage = u.id !== currentUserId && (canManageStaff || u.role === "client");
        return (
          <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                <span className="truncate">{u.full_name || u.email}</span>
                {!u.is_active && <Badge variant="outline">Deactivated</Badge>}
                {u.id === currentUserId && <Badge variant="secondary">You</Badge>}
              </p>
              <p className="truncate text-sm text-muted-foreground">{u.email}</p>
              <p className="text-xs text-muted-foreground">
                {u.role === "client" ? u.organization?.legal_name : ROLE_LABELS[u.role]}
                {" · "}
                {u.last_login_at ? `Last sign-in ${formatDate(u.last_login_at)}` : "Has not signed in yet"}
              </p>
            </div>
            {canManage && (
              <form action={setUserActive.bind(null, u.id, !u.is_active)}>
                <Button type="submit" variant={u.is_active ? "outline" : "secondary"} size="sm">
                  {u.is_active ? "Deactivate" : "Reactivate"}
                </Button>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );
}
