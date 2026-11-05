/**
 * Role rules shared by proxy.ts, the DAL and the UI.
 * These only decide routing and what to show. The database (RLS) remains
 * the authority on what data each role can actually read or change.
 */
import type { Database } from "@/lib/supabase/database.types";

export type AppRole = Database["public"]["Enums"]["app_role"];

export const APP_ROLES = [
  "admin",
  "ops_manager",
  "doc_officer",
  "clearing_agent",
  "transport_coord",
  "driver",
  "finance",
  "client",
] as const satisfies readonly AppRole[];

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "System administrator",
  ops_manager: "Operations manager",
  doc_officer: "Documentation officer",
  clearing_agent: "Clearing agent",
  transport_coord: "Transport coordinator",
  driver: "Driver / transporter",
  finance: "Finance officer",
  client: "Client",
};

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}

export function isStaffRole(role: AppRole): boolean {
  return role !== "client";
}

export type Area = "portal" | "admin";

/** Where each role lands after signing in. */
export function homePathFor(role: AppRole): "/portal" | "/admin" {
  return isStaffRole(role) ? "/admin" : "/portal";
}

/** Which protected area a path belongs to (null = public). */
export function areaOf(pathname: string): Area | null {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  if (pathname === "/portal" || pathname.startsWith("/portal/")) return "portal";
  return null;
}

export function canUseArea(role: AppRole, area: Area): boolean {
  return area === "admin" ? isStaffRole(role) : !isStaffRole(role);
}

/**
 * Validates a post-login "next" path. It must be a local path (no protocol,
 * no "//host"), inside the area the role may use. Otherwise it returns null,
 * so open redirects to other sites are impossible.
 */
export function safeNextPath(next: string | null | undefined, role: AppRole): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  let url: URL;
  try {
    url = new URL(next, "http://local.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "http://local.invalid") return null;
  // Document links (opened from a notification or e-mail) check access themselves
  if (/^\/documents\/[0-9a-f-]{36}$/i.test(url.pathname)) return url.pathname + url.search;
  const area = areaOf(url.pathname);
  if (!area || !canUseArea(role, area)) return null;
  return url.pathname + url.search;
}
