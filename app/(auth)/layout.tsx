import Link from "next/link";

/** Shared, static frame for the sign-in and password pages. */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-muted/40">
      <header className="bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-5xl items-center px-4 py-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            NGB <span className="text-warning dark:text-warning-foreground">LOGISTICS</span>
          </Link>
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
