"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Home, Package, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/portal", label: "Overview", icon: Home, exact: true },
  { href: "/portal/shipments", label: "Shipments", icon: Package },
  { href: "/portal/notifications", label: "Notifications", icon: Bell, badge: true },
  { href: "/portal/settings", label: "Settings", icon: Settings },
] as const;

/** Portal navigation: tabs under the header on wider screens, a bottom bar on phones. */
export function PortalNav({ unread }: { unread: number }) {
  const pathname = usePathname();
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const count = unread > 99 ? "99+" : String(unread);

  return (
    <>
      <nav aria-label="Portal" className="hidden border-b bg-background sm:block">
        <div className="mx-auto flex max-w-6xl gap-1 px-4">
          {ITEMS.map((i) => {
            const active = isActive(i.href, "exact" in i ? i.exact : false);
            return (
              <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}
                className={cn("flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                  active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {i.label}
                {"badge" in i && unread > 0 && (
                  <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground" aria-label={`${count} unread`}>{count}</span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>
      <nav aria-label="Portal" className="fixed inset-x-0 bottom-0 z-20 border-t bg-background pb-[env(safe-area-inset-bottom)] sm:hidden">
        <ul className="grid grid-cols-4">
          {ITEMS.map((i) => {
            const active = isActive(i.href, "exact" in i ? i.exact : false);
            const Icon = i.icon;
            return (
              <li key={i.href}>
                <Link href={i.href} aria-current={active ? "page" : undefined}
                  className={cn("relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs",
                    active ? "font-medium text-primary" : "text-muted-foreground")}>
                  <Icon className="size-5" aria-hidden />
                  {i.label}
                  {"badge" in i && unread > 0 && (
                    <span className="absolute top-1.5 left-1/2 ml-1.5 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] leading-4 text-white" aria-label={`${count} unread`}>
                      {count}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
