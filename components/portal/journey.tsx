import { Check } from "lucide-react";
import { JOURNEY, journeyStep } from "@/lib/domain/portal";
import type { ShipmentStatus } from "@/lib/domain/status-labels";
import { cn } from "@/lib/utils";

/** Six-step progress bar: booked → at port → in transit → arrived → delivered → empty returned. */
export function Journey({ status, compact = false }: { status: ShipmentStatus; compact?: boolean }) {
  const current = journeyStep(status);
  return (
    <ol className="grid grid-cols-6 gap-1" aria-label={`Progress: ${JOURNEY[current].label}`}>
      {JOURNEY.map((s, i) => (
        <li key={s.label} className="flex min-w-0 flex-col gap-1" aria-current={i === current ? "step" : undefined}>
          <span className={cn("flex h-1.5 rounded-full", i <= current ? "bg-primary" : "bg-muted")} />
          {!compact && (
            <span className={cn("flex items-center gap-0.5 text-[11px] leading-tight sm:text-xs",
              i === current ? "font-medium text-foreground" : "text-muted-foreground")}>
              {i < current && <Check className="hidden size-3 shrink-0 sm:inline" aria-hidden />}
              <span className="break-words">{s.label}</span>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
