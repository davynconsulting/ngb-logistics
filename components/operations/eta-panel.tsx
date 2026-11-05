import { formatDateTime } from "@/lib/format";
import { ETA_REASON_LABELS, formatChange } from "@/lib/domain/operations";
import type { EtaRevision } from "@/lib/dal/operations";
import { Badge } from "@/components/ui/badge";
import { EtaForm } from "@/components/operations/eta-form";

/** Current ETA, why it changed, and every previous value (FRS §6.2, AC-09). */
export function EtaPanel({
  shipmentId, current, reason, updatedAt, history, timeZone, canEdit,
}: {
  shipmentId: string;
  current: string | null;
  reason: string | null;
  updatedAt: string | null;
  history: EtaRevision[];
  timeZone: string;
  canEdit: boolean;
}) {
  return (
    <section id="eta" className="flex scroll-mt-20 flex-col gap-4 rounded-lg border bg-card p-4 sm:p-6">
      <div>
        <h2 className="text-lg font-medium">ETA at destination</h2>
        <p className="mt-1 text-2xl font-semibold">{current ? formatDateTime(current, timeZone) : "Not set"}</p>
        {reason && <p className="text-sm text-muted-foreground">{reason}{updatedAt ? ` · updated ${formatDateTime(updatedAt, timeZone)}` : ""}</p>}
      </div>
      {canEdit && <EtaForm shipmentId={shipmentId} />}
      {history.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm font-medium">ETA history ({history.length})</summary>
          <ol className="mt-2 flex flex-col divide-y text-sm">
            {history.map((r) => (
              <li key={r.id} className="flex flex-col gap-0.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{r.previous_eta ? `${formatDateTime(r.previous_eta, timeZone)} → ` : ""}<strong>{formatDateTime(r.new_eta, timeZone)}</strong></span>
                  <span className="text-muted-foreground">{formatChange(r.change_minutes)}</span>
                  {r.is_material ? <Badge variant="secondary" className="bg-warning/25 text-warning-foreground">Material</Badge> : <Badge variant="outline">Minor</Badge>}
                  {!r.client_visible && <Badge variant="outline">Staff only</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {ETA_REASON_LABELS[r.reason_category]}: {r.reason} · {r.revised_by_profile?.full_name ?? "Staff"}, {formatDateTime(r.revised_at, timeZone)}
                </p>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
