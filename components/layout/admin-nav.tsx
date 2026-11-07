import { getCurrentUser } from "@/lib/dal/session";
import type { AppRole } from "@/lib/auth/roles";
import { NavLinks, type NavItem } from "./nav-links";

const ITEMS: (NavItem & { roles?: AppRole[] })[] = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/shipments", label: "Shipments" },
  { href: "/admin/exceptions", label: "Exceptions", roles: ["admin", "ops_manager", "doc_officer", "clearing_agent", "transport_coord", "finance"] },
  { href: "/admin/clients", label: "Clients", roles: ["admin", "ops_manager", "doc_officer", "finance"] },
  { href: "/admin/finance", label: "Finance", roles: ["admin", "ops_manager", "finance"] },
  { href: "/admin/reports", label: "Reports", roles: ["admin", "ops_manager", "finance"] },
  { href: "/admin/users", label: "Users", roles: ["admin", "ops_manager"] },
  { href: "/admin/notifications", label: "Notifications", roles: ["admin", "ops_manager"] },
];

/** Admin section links, filtered by role. (Pages still enforce access themselves.) */
export async function AdminNav() {
  const user = await getCurrentUser();
  if (!user) return null;
  const items = ITEMS.filter((i) => !i.roles || i.roles.includes(user.role)).map((i) => ({ href: i.href, label: i.label, exact: i.exact }));
  return <NavLinks items={items} />;
}
