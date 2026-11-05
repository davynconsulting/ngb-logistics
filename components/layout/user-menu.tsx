import Link from "next/link";
import { Settings } from "lucide-react";
import { getCurrentUser } from "@/lib/dal/session";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "./sign-out-button";

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
      <Button asChild variant="ghost" size="icon-sm" aria-label="Settings" className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground">
        <Link href={user.role === "driver" ? "/driver/settings" : user.isStaff ? "/admin/account" : "/portal/settings"}><Settings aria-hidden /></Link>
      </Button>
      <SignOutButton />
    </div>
  );
}
