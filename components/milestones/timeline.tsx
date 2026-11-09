import { EyeOff, Lock, MapPin, ShieldAlert, Truck, User } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { SOURCE_LABELS, canCorrect, groupBatches } from "@/lib/domain/milestones";
import type { MilestoneData } from "@/lib/dal/milestones";
import type { AppRole } from "@/lib/auth/roles";
import { Badge } from "@/components/ui/badge";
import { CorrectControls } from "@/components/milestones/correct-controls";
import { cn } from "@/lib/utils";

/**
 * Staff timeline: newest first, one entry per recorded action (which may cover
 * several containers). Corrections and cancellations are shown on the entry,
 * and the original values stay visible (FRS §6.4, AC-03).
 */
export function MilestoneTimeline({
  data, containers, timeZone, user,
}: {
  data: MilestoneData;
  containers: { id: string; label: string }[];
  timeZone: string;
  user: { id: string; role: AppRole };
}) {
  const labels = new Map(data.catalogue.map((c) => [c.milestone_type, c.label]));
  const containerLabel = (id: string | null) => (id ? containers.find((c) => c.id === id)?.label ?? "Container" : null);
  const batches = groupBatches(data.events);

  if (batches.length === 0) {
    return <p className="text-sm text-muted-foreground">No milestones recorded yet.</p>;
  }

  return (
    <ol className="relative flex flex-col gap-4 border-l pl-5">
      {batches.map(({ batchId, events }) => {
        const first = events[0];
        const live = events.filter((e) => !e.is_voided);
        const allVoided = live.length === 0;
        const conts = events.map((e) => containerLabel(e.container_id)).filter(Boolean) as string[];
        const notes = data.notesByBatch[batchId] ?? [];
        const correctable = live.filter((e) => canCorrect(user.role, user.id, e));
        return (
          <li key={batchId} className="relative">
            <span aria-hidden className={cn("absolute top-1.5 -left-[26px] size-3 rounded-full border-2 border-background",
              allVoided ? "bg-muted-foreground/40" : first.is_override ? "bg-warning" : "bg-primary")} />
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className={cn("font-medium", allVoided && "line-through")}>{labels.get(first.milestone_type) ?? first.milestone_type}</span>
                <time className="text-sm text-muted-foreground" dateTime={first.event_at}>{formatDateTime(first.event_at, timeZone)}</time>
                {first.is_override && <Badge variant="secondary" className="bg-warning/25 text-warning-foreground dark:text-warning"><ShieldAlert aria-hidden /> Override</Badge>}
                {!first.client_visible && <Badge variant="outline"><EyeOff aria-hidden /> Staff only</Badge>}
                {events.some((e) => e.is_corrected) && <Badge variant="outline">Corrected</Badge>}
                {events.some((e) => e.is_voided) && <Badge variant="secondary" className="bg-destructive/10 text-destructive">
                  {allVoided ? "Cancelled" : "Partly cancelled"}</Badge>}
              </div>
              {conts.length > 0 && (
                <p className="flex flex-wrap gap-1 text-xs">
                  {events.map((e) => e.container_id && (
                    <span key={e.id} className={cn("rounded bg-muted px-1.5 py-0.5 font-mono", e.is_voided && "line-through")}>
                      {containerLabel(e.container_id)}
                    </span>
                  ))}
                </p>
              )}
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {first.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3" aria-hidden />{first.location}</span>}
                <span className="inline-flex items-center gap-1">
                  {first.source === "driver" ? <Truck className="size-3" aria-hidden /> : <User className="size-3" aria-hidden />}
                  {first.recorder}{first.source && first.source !== "staff" ? ` (${SOURCE_LABELS[first.source]})` : ""} · recorded {formatDateTime(first.recorded_at, timeZone)}
                </span>
              </p>
              {first.public_note && <p className="text-sm">{first.public_note}</p>}
              {first.is_override && first.override_reason && (
                <p className="text-xs"><span className="text-muted-foreground">Override reason:</span> {first.override_reason}</p>
              )}
              {notes.map((n, i) => (
                <p key={i} className="flex gap-1 rounded bg-muted/60 px-2 py-1 text-xs">
                  <Lock className="mt-0.5 size-3 shrink-0" aria-hidden /><span><span className="text-muted-foreground">Internal: </span>{n}</span>
                </p>
              ))}
              {events.filter((e) => e.is_corrected && !e.is_voided).map((e) => (
                <p key={`c-${e.id}`} className="text-xs text-muted-foreground">
                  {containerLabel(e.container_id) ? `${containerLabel(e.container_id)}: ` : ""}
                  corrected by {e.corrector} on {formatDateTime(e.corrected_at, timeZone)}
                  {e.original_event_at !== e.event_at && <> (originally {formatDateTime(e.original_event_at, timeZone)})</>}: {e.correction_reason}
                </p>
              ))}
              {events.filter((e) => e.is_voided).map((e) => (
                <p key={`v-${e.id}`} className="text-xs text-destructive">
                  {containerLabel(e.container_id) ? `${containerLabel(e.container_id)}: ` : ""}
                  cancelled by {e.voider} on {formatDateTime(e.voided_at, timeZone)}: {e.void_reason}
                </p>
              ))}
              {correctable.length > 0 && (
                <CorrectControls targets={correctable.map((e) => ({
                  eventId: e.id,
                  label: containerLabel(e.container_id) ?? "Whole shipment",
                  eventAt: e.event_at,
                  location: e.location,
                  publicNote: e.public_note,
                }))} />
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
