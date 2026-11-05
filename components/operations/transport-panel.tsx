import { formatDateTime } from "@/lib/format";
import type { TransportAssignment } from "@/lib/dal/operations";
import { Badge } from "@/components/ui/badge";
import { AssignTruckForm } from "@/components/operations/assign-truck-form";
import { CancelTruck } from "@/components/operations/cancel-truck";

/** Truck assignments (FRS §6.5) and the assign form. Driver contact is staff-only (RLS). */
export function TransportPanel({
  shipmentId, assignments, containerLabel, timeZone, canAssign, form,
}: {
  shipmentId: string;
  assignments: TransportAssignment[];
  containerLabel: (id: string) => string;
  timeZone: string;
  canAssign: boolean;
  form: React.ComponentProps<typeof AssignTruckForm> | null;
}) {
  return (
    <section id="transport" className="flex scroll-mt-20 flex-col gap-4 rounded-lg border bg-card p-4 sm:p-6">
      <h2 className="text-lg font-medium">Transport</h2>
      {assignments.length === 0 && <p className="text-sm text-muted-foreground">No truck assigned yet.</p>}
      <ul className="flex flex-col gap-3">
        {assignments.map((a) => (
          <li key={a.id} className={`flex flex-col gap-1 rounded-md border p-3 text-sm ${a.status === "cancelled" ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-medium">{a.truck_registration}</span>
              {a.trailer_registration && <span className="font-mono text-muted-foreground">+ {a.trailer_registration}</span>}
              <span>{a.transporter_name}</span>
              {a.status === "cancelled" ? <Badge variant="secondary" className="bg-destructive/10 text-destructive">Cancelled</Badge> : <Badge variant="secondary">Active</Badge>}
            </div>
            <p className="flex flex-wrap gap-1 text-xs">
              {a.containers.map((c) => <span key={c.container_id} className="rounded bg-muted px-1.5 py-0.5 font-mono">{containerLabel(c.container_id)}</span>)}
            </p>
            <dl className="grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
              {a.route && <div><dt className="inline">Route: </dt><dd className="inline">{a.route.name} (~{a.route.transit_estimate_hours} h)</dd></div>}
              {a.border_crossing && <div><dt className="inline">Border: </dt><dd className="inline">{a.border_crossing}</dd></div>}
              {a.driver && <div><dt className="inline">Driver: </dt><dd className="inline">{a.driver.driver_name}{a.driver.driver_phone ? ` · ${a.driver.driver_phone}` : ""}</dd></div>}
              <div><dt className="inline">Loading: </dt><dd className="inline">
                {a.actual_loading_at ? `loaded ${formatDateTime(a.actual_loading_at, timeZone)}` : a.planned_loading_at ? `planned ${formatDateTime(a.planned_loading_at, timeZone)}` : "not planned"}
              </dd></div>
              {a.transit_document_refs.length > 0 && <div><dt className="inline">Transit docs: </dt><dd className="inline">{a.transit_document_refs.join(", ")}</dd></div>}
              <div><dt className="inline">Assigned: </dt><dd className="inline">{formatDateTime(a.assigned_at, timeZone)}</dd></div>
            </dl>
            {a.status === "cancelled" && a.cancel_reason && <p className="text-xs text-destructive">Cancelled {formatDateTime(a.cancelled_at, timeZone)}: {a.cancel_reason}</p>}
            {a.status === "active" && canAssign && <CancelTruck assignmentId={a.id} />}
          </li>
        ))}
      </ul>
      {form && form.candidates.length > 0 && (
        <div className="border-t pt-4">
          <h3 className="mb-3 font-medium">Assign a truck</h3>
          <AssignTruckForm key={form.candidates.map((c) => c.id).join()} {...form} shipmentId={shipmentId} />
        </div>
      )}
    </section>
  );
}
