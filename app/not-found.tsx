import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Not found", robots: { index: false } };

/**
 * Unknown addresses, and anything a page hides with notFound() (including another client's shipment,
 * invoice or receipt: the same page as for one that does not exist, AC-05/AC-16).
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">This page could not be found</h1>
      <p className="text-muted-foreground">The address may be mistyped, or you may not have access to it.</p>
      <Button asChild>
        <Link href="/">Go to the home page</Link>
      </Button>
    </main>
  );
}
