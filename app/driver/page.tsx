import type { Metadata } from "next";
import { Suspense } from "react";
import { requireDriver } from "@/lib/dal/session";
import { listDriverJobs } from "@/lib/dal/driver";
import { jobStage } from "@/lib/domain/driver";
import { PageHeader } from "@/components/layout/page-header";
import { DriverJobCard } from "@/components/driver/job-card";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "My jobs" };

export default function DriverHomePage() {
  return (
    <Suspense fallback={<div className="flex flex-col gap-3"><Skeleton className="h-10 w-40" /><Skeleton className="h-24 w-full" /></div>}>
      <Jobs />
    </Suspense>
  );
}

async function Jobs() {
  const user = await requireDriver();
  const jobs = await listDriverJobs();
  const open = jobs.filter((j) => jobStage(j.containers).tone !== "done");
  const done = jobs.filter((j) => jobStage(j.containers).tone === "done");
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="My jobs" description={`${user.fullName || user.email} · trucks assigned to you by NGB`} />
      {jobs.length === 0 && (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          No jobs right now. When NGB assigns you to a truck, it appears here.
        </p>
      )}
      {open.length > 0 && (
        <ul className="flex flex-col gap-3" aria-label="Current jobs">
          {open.map((j) => <li key={j.assignment_id}><DriverJobCard job={j} /></li>)}
        </ul>
      )}
      {done.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Delivered (until NGB closes the shipment)</h2>
          <ul className="flex flex-col gap-3">
            {done.map((j) => <li key={j.assignment_id}><DriverJobCard job={j} /></li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
