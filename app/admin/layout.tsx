import { Suspense } from "react";
import { AppHeader } from "@/components/layout/app-header";
import { AdminNav } from "@/components/layout/admin-nav";

/** Internal console frame. Access is checked by each page (requireStaff) and by RLS. */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-muted/30">
      <AppHeader home="/admin" label="Operations console" />
      <div className="border-b bg-background print:hidden">
        <div className="mx-auto max-w-6xl px-2 sm:px-4">
          <Suspense fallback={<div className="h-11" />}>
            <AdminNav />
          </Suspense>
        </div>
      </div>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
