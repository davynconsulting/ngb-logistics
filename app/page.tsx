import Link from "next/link";
import { Container, FileCheck2, Truck, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";

const features = [
  {
    icon: Container,
    title: "Container-level tracking",
    text: "Follow every container from port discharge to empty return.",
  },
  {
    icon: Truck,
    title: "Live milestones & ETA",
    text: "Confirmed updates from our team, with the reason for any ETA change.",
  },
  {
    icon: FileCheck2,
    title: "Documents in one place",
    text: "Bills of lading, release documents and proof of delivery.",
  },
  {
    icon: Wallet,
    title: "Invoices & payments",
    text: "See what is due, what is paid and download your receipts.",
  },
];

/** Public landing page. Static: must not read cookies or the session. */
export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <span className="text-lg font-semibold tracking-tight">
            NGB <span className="text-warning">LOGISTICS</span>
          </span>
          <Button asChild variant="secondary" size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-10 sm:py-16">
        <section className="flex flex-col gap-4">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Know where your cargo is, without making a call.
          </h1>
          <p className="max-w-2xl text-muted-foreground text-pretty">
            Track shipments from Dar es Salaam and Mombasa through customs,
            road transit and delivery, with alerts on your phone and WhatsApp.
          </p>
          <div>
            <Button asChild size="lg">
              <Link href="/login">Track my shipments</Link>
            </Button>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          {features.map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex gap-3 rounded-lg border bg-card p-4">
              <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <div>
                <h2 className="font-medium">{title}</h2>
                <p className="text-sm text-muted-foreground">{text}</p>
              </div>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t px-4 py-6 text-center text-xs text-muted-foreground">
        © NGB LOGISTICS · Cargo Tracking
      </footer>
    </div>
  );
}
