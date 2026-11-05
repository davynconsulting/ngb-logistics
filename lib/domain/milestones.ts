import type { Database } from "@/lib/supabase/database.types";
import type { AppRole } from "@/lib/auth/roles";
import type { ShipmentStatus } from "@/lib/domain/status-labels";

type Enums = Database["public"]["Enums"];
export type MilestoneType = Enums["milestone_type"];
export type CustomsStatus = Enums["customs_status"];
export type TransportStatus = Enums["transport_status"];
export type DeliveryStatus = Enums["delivery_status"];
export type ReturnStatus = Enums["return_status"];
export type LocationKind = Enums["location_kind"];
export type EventSource = Enums["event_source"];
export type CatalogueEntry = Database["public"]["Tables"]["milestone_catalogue"]["Row"];

export const CUSTOMS_STATUS_LABELS: Record<CustomsStatus, string> = {
  not_started: "Not started",
  entry_in_preparation: "Entry in preparation",
  submitted: "Submitted",
  inspection: "Inspection",
  duties_pending: "Duties pending",
  released: "Released",
  on_hold: "On hold",
};

export const TRANSPORT_STATUS_LABELS: Record<TransportStatus, string> = {
  unassigned: "No truck yet",
  assigned: "Truck assigned",
  awaiting_loading: "Loading",
  loaded: "Loaded",
  in_transit: "In transit",
  at_border: "At border",
  arrived: "Arrived",
  delayed: "Delayed",
};

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: "Not delivered",
  offloading: "Offloading",
  delivered: "Delivered",
  pod_pending: "Delivered, POD pending",
  pod_received: "POD received",
};

export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  not_due: "Not due",
  awaiting_empty_return: "Awaiting empty return",
  returned: "Returned",
  return_overdue: "Return overdue",
  dispute: "Dispute",
};

export const LOCATION_KIND_LABELS: Record<LocationKind, string> = {
  terminal: "Port terminal",
  icd: "Inland container depot (ICD)",
  in_transit: "In transit",
  destination: "Destination",
  depot: "Empty depot",
};

export const SOURCE_LABELS: Record<EventSource, string> = {
  staff: "Staff",
  driver: "Driver",
  integration: "Integration",
  system: "System",
};

/** Milestones grouped for the picker, in workflow order. */
export function milestoneGroup(sortOrder: number): "Port" | "Road transport" | "Delivery & return" | "Customs" | "Other" {
  if (sortOrder < 60) return "Port";
  if (sortOrder < 140) return "Road transport";
  if (sortOrder < 200) return "Delivery & return";
  if (sortOrder < 900) return "Customs";
  return "Other";
}

export type ContainerState = { id: string; label: string; operational_status: ShipmentStatus };
export type ShipmentState = { overall_status: ShipmentStatus; customs_status: CustomsStatus };

export type MilestoneOption = {
  entry: CatalogueEntry;
  /** Containers for which the milestone is the next valid step. */
  eligible: string[];
  /** Containers that are already past this step (a correction is needed instead). */
  past: string[];
  /** Why the milestone is not the next step (empty = in order). */
  problems: string[];
};

const OVERRIDE_ROLES: AppRole[] = ["admin", "ops_manager"];
export const canOverride = (role: AppRole) => OVERRIDE_ROLES.includes(role);

const statusIndex = (s: ShipmentStatus, order: readonly ShipmentStatus[]) => order.indexOf(s);

/**
 * The milestones a role may record now, with UI hints. This mirrors
 * record_milestone() so the form can guide the user; the database
 * re-checks everything and is the only authority.
 *
 * `statusOrder` is the shipment_status enum order (from the generated constants).
 */
export function milestoneOptions(
  catalogue: readonly CatalogueEntry[],
  role: AppRole,
  shipment: ShipmentState,
  containers: readonly ContainerState[],
  statusOrder: readonly ShipmentStatus[],
): MilestoneOption[] {
  if (shipment.overall_status === "closed") return [];
  return [...catalogue]
    .filter((e) => e.allowed_roles.includes(role))
    .filter((e) => shipment.overall_status !== "draft" || e.milestone_type === "shipment_confirmed" || e.milestone_type === "update")
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((entry) => {
      const problems: string[] = [];
      const eligible: string[] = [];
      const past: string[] = [];
      if (entry.requires_overall && !entry.requires_overall.includes(shipment.overall_status)) {
        problems.push(`shipment is ${shipment.overall_status.replaceAll("_", " ")}`);
      }
      if (entry.requires_customs && !entry.requires_customs.includes(shipment.customs_status)) {
        problems.push(`customs is ${CUSTOMS_STATUS_LABELS[shipment.customs_status].toLowerCase()}`);
      }
      if (entry.milestone_type === "gate_out" && shipment.customs_status !== "released") {
        problems.push("customs is not released");
      }
      if (entry.scope !== "shipment" || entry.requires_operational) {
        for (const c of containers) {
          const sets = entry.sets_operational;
          if (sets && statusIndex(c.operational_status, statusOrder) >= statusIndex(sets, statusOrder)) {
            past.push(c.id);
          } else if (!entry.requires_operational || entry.requires_operational.includes(c.operational_status)) {
            eligible.push(c.id);
          }
        }
        // shipment-wide milestones need every container in the required state
        if (entry.scope === "shipment" && entry.requires_operational && eligible.length !== containers.length) {
          problems.push("not every container is ready");
        }
      }
      return { entry, eligible, past, problems };
    });
}

/** Whether the correct/cancel controls are offered (the database re-checks). */
export function canCorrect(role: AppRole, userId: string, event: { recorded_by: string | null; recorded_at: string }, now = Date.now()) {
  if (canOverride(role)) return true;
  if (role === "client" || role === "finance") return false;
  return event.recorded_by === userId && now - new Date(event.recorded_at).getTime() < 24 * 3600e3;
}

type TimelineRow = {
  id: string; batch_id: string; container_id: string | null; event_at: string; recorded_at: string;
};

/**
 * Groups timeline events recorded together (one batch = one action, possibly
 * several containers). Newest first by event time.
 */
export function groupBatches<T extends TimelineRow>(rows: readonly T[]): { batchId: string; events: T[] }[] {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const list = map.get(r.batch_id);
    if (list) list.push(r);
    else map.set(r.batch_id, [r]);
  }
  const key = (events: T[]) => Math.max(...events.map((e) => new Date(e.event_at).getTime()));
  return [...map.entries()]
    .map(([batchId, events]) => ({ batchId, events }))
    .sort((a, b) => key(b.events) - key(a.events) || b.events[0].recorded_at.localeCompare(a.events[0].recorded_at));
}

/** "2026-11-05T09:30" for <input type="datetime-local">, in the browser's time zone. */
export function toLocalInputValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
