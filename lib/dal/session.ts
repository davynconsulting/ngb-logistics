import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { homePathFor, isStaffRole, type AppRole } from "@/lib/auth/roles";

/**
 * Data Access Layer: the single place that decides who the current user is.
 *
 * - Verifies the session JWT with getClaims() (never trusts getSession()).
 * - Loads the profile from the database, so a deactivated user or a changed
 *   role takes effect immediately, even while their token is still valid.
 * - React cache() de-duplicates the lookup within ONE request only. It is
 *   never cached across requests or users.
 *
 * Reads cookies, so with Cache Components every caller must render inside
 * a <Suspense> boundary.
 */
export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
  isStaff: boolean;
  organizationId: string;
  organizationName: string;
};

type SessionState =
  | { status: "anonymous" }
  | { status: "no_access" } // valid login, but no active profile (deactivated / not set up)
  | { status: "ok"; user: SessionUser };

const getSessionState = cache(async (): Promise<SessionState> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return { status: "anonymous" };

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "id, role, full_name, is_active, organization_id, organization:organizations!profiles_organization_id_fkey(legal_name)",
    )
    .eq("id", data.claims.sub)
    .maybeSingle();

  if (!profile || !profile.is_active) return { status: "no_access" };

  const user: SessionUser = {
    id: profile.id,
    email: typeof data.claims.email === "string" ? data.claims.email : "",
    fullName: profile.full_name,
    role: profile.role,
    isStaff: isStaffRole(profile.role),
    organizationId: profile.organization_id,
    organizationName: profile.organization?.legal_name ?? "",
  };
  return { status: "ok", user };
});

/** The signed-in, active user, or null. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const state = await getSessionState();
  return state.status === "ok" ? state.user : null;
}

/** Any active signed-in user. Otherwise redirect to /login (or sign out a deactivated user). */
export async function requireUser(): Promise<SessionUser> {
  const state = await getSessionState();
  if (state.status === "anonymous") redirect("/login");
  // Signed in but deactivated: end the session first (a Server Component
  // cannot clear cookies), otherwise proxy.ts would bounce them back here.
  if (state.status === "no_access") redirect("/auth/signout?reason=no_access");
  return state.user;
}

/** NGB staff only. Clients are sent to their portal. */
export async function requireStaff(...allowed: AppRole[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isStaff) redirect(homePathFor(user.role));
  if (allowed.length && !allowed.includes(user.role)) redirect("/admin");
  return user;
}

/** Client users only. Staff are sent to the admin console. */
export async function requireClient(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.isStaff) redirect(homePathFor(user.role));
  return user;
}
