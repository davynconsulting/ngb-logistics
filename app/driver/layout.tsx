import { AppHeader } from "@/components/layout/app-header";

/** Driver pages: phone-first, one column. Access is checked by each page (requireDriver) and by RLS (0020). */
export default function DriverLayout({ children }: LayoutProps<"/driver">) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-muted/30">
      <AppHeader home="/driver" label="Driver" />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-6 pb-10">{children}</main>
    </div>
  );
}
