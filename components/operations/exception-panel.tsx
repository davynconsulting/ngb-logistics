import { formatDateTime } from "@/lib/format";
import { UPDATE_KIND_LABELS } from "@/lib/domain/operations";
import type { ShipmentException } from "@/lib/dal/operations";
import type { AppRole } from "@/lib/auth/roles";
import { ExceptionSummary } from "@/components/operations/exception-card";
import { ExceptionActions } from "@/components/operations/exception-actions";
import { OpenExceptionForm } from "@/components/operations/open-exception-form";
import { ClientMessageForm } from "@/components/operations/client-message-form";

/** Exceptions on one shipment: open ones first, with their follow-up log (FRS §8). */
export function ExceptionPanel({
  shipmentId, exceptions, containers, staff, user, timeZone, milestoneLabel, canManage,
}: {
  shipmentId: string;
  exceptions: ShipmentException[];
  containers: { id: string; label: string }[];
  staff: { id: string; label: string }[];
  user: { id: string; role: AppRole };
  timeZone: string;
  milestoneLabel: (t: string) => string;
  canManage: boolean;
}) {
  const open = exceptions.filter((x) => x.status === "open");
  const resolved = exceptions.filter((x) => x.status === "resolved");
  const lead = user.role === "admin" || user.role === "ops_manager";
  return (
    <section id="exceptions" className="flex scroll-mt-20 flex-col gap-4 rounded-lg border bg-card p-4 sm:p-6">
      <h2 className="text-lg font-medium">Exceptions {open.length > 0 && <span className="text-warning-foreground dark:text-warning">({open.length} open)</span>}</h2>
      {exceptions.length === 0 && <p className="text-sm text-muted-foreground">No exceptions.</p>}
      <ul className="flex flex-col gap-3">
        {[...open, ...resolved].map((x) => (
          <li key={x.id} className={`flex flex-col gap-2 rounded-md border p-3 ${x.status === "resolved" ? "opacity-70" : ""}`}>
            <ExceptionSummary x={x} timeZone={timeZone} milestoneLabel={milestoneLabel} />
            {x.details && <p className="text-xs"><span className="text-muted-foreground">Details: </span>{x.details}</p>}
            {x.resolution && <p className="text-xs"><span className="text-muted-foreground">Resolution: </span>{x.resolution}</p>}
            {x.updates.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs font-medium">History ({x.updates.length})</summary>
                <ol className="mt-1 flex flex-col gap-1 text-xs">
                  {x.updates.map((u) => (
                    <li key={u.id}>
                      <span className="text-muted-foreground">{formatDateTime(u.created_at, timeZone)} · {u.by?.full_name ?? "System"} · {UPDATE_KIND_LABELS[u.kind]}</span>
                      {u.note && <>: {u.note}</>}
                    </li>
                  ))}
                </ol>
              </details>
            )}
            {x.status === "open" && canManage && (lead || x.owner_id === user.id) && (
              <ClientMessageForm exceptionId={x.id} message={x.client_message} visible={x.client_visible} />
            )}
            {x.status === "open" && canManage && (
              <ExceptionActions exceptionId={x.id} staff={staff} canLead={lead || x.owner_id === user.id} canEscalate={!x.escalated_at} />
            )}
          </li>
        ))}
      </ul>
      {canManage && <OpenExceptionForm shipmentId={shipmentId} containers={containers} staff={staff} />}
    </section>
  );
}
