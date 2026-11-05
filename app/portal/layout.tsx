import { Suspense } from "react";
import { AppHeader } from "@/components/layout/app-header";
import { PortalNavWithCount } from "@/components/portal/portal-nav-server";

/** Client portal frame. Access is checked by each page (requireClient) and by RLS. */
export default function PortalLayout({ children }: LayoutProps<"/portal">) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-muted/30">
      <AppHeader home="/portal" label="Client portal" />
      <Suspense fallback={<div className="hidden h-11 border-b bg-background sm:block" aria-hidden />}>
        <PortalNavWithCount />
      </Suspense>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-24 sm:pb-8">{children}</main>
    </div>
  );
}
