import { LogOut } from "lucide-react";
import { signOut } from "@/lib/actions/auth";
import { getCurrentUser } from "@/lib/dal/session";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";

/** Signed-in user's name, organization/role and a sign-out button. Render inside <Suspense>. */
export async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="min-w-0 text-right leading-tight">
        <p className="truncate text-sm font-medium">{user.fullName || user.email}</p>
        <p className="truncate text-xs opacity-80">
          {user.isStaff ? ROLE_LABELS[user.role] : user.organizationName}
        </p>
      </div>
      <form action={signOut}>
        <Button type="submit" variant="secondary" size="sm" aria-label="Sign out">
          <LogOut aria-hidden />
          <span className="hidden sm:inline">Sign out</span>
        </Button>
      </form>
    </div>
  );
}
