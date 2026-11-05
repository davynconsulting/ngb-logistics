import { AppHeader } from "@/components/layout/app-header";

/** Client portal frame. Access is checked by each page (requireClient) and by RLS. */
export default function PortalLayout({ children }: LayoutProps<"/portal">) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-muted/30">
      <AppHeader home="/portal" label="Client portal" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
