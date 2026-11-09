import Link from "next/link";
import { Suspense } from "react";
import { UserMenu } from "./user-menu";

/** Top bar for the portal and admin areas. The user part streams in (it reads the session). */
export function AppHeader({ home, label }: { home: string; label: string }) {
  return (
    <header className="sticky top-0 z-10 bg-primary text-primary-foreground shadow-sm print:hidden">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <Link href={home} className="shrink-0 leading-tight">
          <span className="block text-base font-semibold tracking-tight">
            NGB <span className="text-warning dark:text-warning-foreground">LOGISTICS</span>
          </span>
          <span className="block text-xs opacity-80">{label}</span>
        </Link>
        <Suspense fallback={<div className="h-9 w-32" aria-hidden />}>
          <UserMenu />
        </Suspense>
      </div>
    </header>
  );
}
