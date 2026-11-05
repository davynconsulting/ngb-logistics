import Link from "next/link";
import { ChevronRight, MapPin, Truck } from "lucide-react";
import type { DriverJob } from "@/lib/dal/driver";
import { jobStage } from "@/lib/domain/driver";
import { cn } from "@/lib/utils";

/** One truck job on the driver's home page. */
export function DriverJobCard({ job }: { job: DriverJob }) {
  const stage = jobStage(job.containers);
  return (
    <Link href={`/driver/jobs/${job.assignment_id}`}
      className="flex items-center gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold">{job.shipment_reference}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium",
            stage.tone === "done" ? "bg-success/15 text-success"
              : stage.tone === "road" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
            {stage.label}
          </span>
        </div>
        <p className="flex min-w-0 items-center gap-1.5 text-sm">
          <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{job.client_name} · {job.destination_city}, {job.destination_country}</span>
        </p>
        <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
          <Truck className="size-4 shrink-0" aria-hidden />
          <span className="truncate">
            {job.truck_registration}{job.trailer_registration ? ` / ${job.trailer_registration}` : ""} ·{" "}
            {job.containers.map((c) => c.container_number).join(", ")}
          </span>
        </p>
      </div>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
