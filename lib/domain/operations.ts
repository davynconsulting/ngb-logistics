import type { Database } from "@/lib/supabase/database.types";
import type { AppRole } from "@/lib/auth/roles";
import type { ShipmentStatus } from "@/lib/domain/status-labels";

type Enums = Database["public"]["Enums"];
export type EtaReasonCategory = Enums["eta_reason_category"];
export type ExceptionType = Enums["exception_type"];
export type ExceptionSeverity = Enums["exception_severity"];
export type ExceptionUpdateKind = Enums["exception_update_kind"];

export const ETA_REASON_LABELS: Record<EtaReasonCategory, string> = {
  schedule_confirmed: "Schedule confirmed",
  vessel_delay: "Vessel delay",
  port_congestion: "Port congestion",
  documents: "Documents",
  customs: "Customs",
  truck_availability: "Truck availability",
  road_conditions: "Road conditions",
  border_delay: "Border delay",
  weather: "Weather",
  client_request: "Client request",
  other: "Other",
};

export const EXCEPTION_TYPE_LABELS: Record<ExceptionType, string> = {
  document_missing: "Missing / invalid document",
  vessel_delay: "Vessel or port delay",
  port_sla_breach: "Port processing over SLA",
  dispatch_risk: "Truck unavailable / loading missed",
  customs_hold: "Customs hold / inspection / duty",
  transit_update_missing: "Transit update missing",
  transit_overdue: "Transit overdue",
  delivery_discrepancy: "Delivery discrepancy / damaged seal",
  return_overdue: "Empty return overdue",
  other: "Other",
};

export const SEVERITY_LABELS: Record<ExceptionSeverity, string> = {
  low: "Low", medium: "Medium", high: "High", critical: "Critical",
};

export const UPDATE_KIND_LABELS: Record<ExceptionUpdateKind, string> = {
  opened: "Opened", note: "Note", follow_up: "Follow-up", owner: "Owner changed",
  severity: "Severity changed", escalated: "Escalated", resolved: "Resolved",
};

/* Role checks for the UI. They mirror the database functions, which decide. */
export const canReviseEta = (r: AppRole) =>
  ["admin", "ops_manager", "doc_officer", "clearing_agent", "transport_coord"].includes(r);
export const canAssignTransport = (r: AppRole) => ["admin", "ops_manager", "transport_coord"].includes(r);
export const canManageExceptions = (r: AppRole) =>
  ["admin", "ops_manager", "doc_officer", "clearing_agent", "transport_coord", "finance"].includes(r);
export const canRunSlaCheck = (r: AppRole) => r === "admin" || r === "ops_manager";
export const isLead = (r: AppRole) => r === "admin" || r === "ops_manager";

const DONE: ShipmentStatus[] = ["delivered", "container_returned", "operationally_complete", "closed"];
export const etaEditable = (overall: ShipmentStatus) => !DONE.includes(overall);

/** "+3 h 20 min" / "−45 min" for an ETA change in minutes. */
export function formatChange(minutes: number | null): string {
  if (minutes == null) return "First ETA";
  const sign = minutes > 0 ? "+" : minutes < 0 ? "−" : "±";
  const m = Math.abs(minutes);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  const parts = [d && `${d} d`, h && `${h} h`, mm && `${mm} min`].filter(Boolean);
  return `${sign}${parts.join(" ") || "0 min"}`;
}

type TransportContainer = { id: string; operational_status: ShipmentStatus };
const BEFORE_DISPATCH: ShipmentStatus[] = [
  "registered", "awaiting_documents", "vessel_arrived", "container_discharged", "port_processing",
];

/**
 * Containers a truck can be assigned to: not gated out yet and without an
 * active truck. `needsOverride` = not yet ready for dispatch.
 */
export function transportCandidates<T extends TransportContainer>(containers: readonly T[], withTruck: ReadonlySet<string>) {
  return containers
    .filter((c) => !withTruck.has(c.id))
    .filter((c) => ["ready_for_dispatch", "truck_assigned", "loading", "loaded", ...BEFORE_DISPATCH].includes(c.operational_status))
    .map((c) => ({ ...c, needsOverride: BEFORE_DISPATCH.includes(c.operational_status) }));
}

export type QueueFilter = "open" | "mine" | "escalated" | "due";
export const QUEUE_FILTERS: { value: QueueFilter; label: string }[] = [
  { value: "open", label: "All open" },
  { value: "mine", label: "Mine" },
  { value: "escalated", label: "Escalated" },
  { value: "due", label: "Follow-up due" },
];
export const parseQueueFilter = (v: unknown): QueueFilter =>
  QUEUE_FILTERS.some((f) => f.value === v) ? (v as QueueFilter) : "open";

const SEVERITY_RANK: Record<ExceptionSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Queue order: escalated first, then severity, then oldest follow-up/opened. */
export function sortQueue<T extends { escalated_at: string | null; severity: ExceptionSeverity; next_follow_up_at: string | null; opened_at: string }>(rows: readonly T[]): T[] {
  const t = (s: string | null) => (s ? new Date(s).getTime() : Number.POSITIVE_INFINITY);
  return [...rows].sort((a, b) =>
    Number(!!b.escalated_at) - Number(!!a.escalated_at)
    || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || t(a.next_follow_up_at) - t(b.next_follow_up_at)
    || t(a.opened_at) - t(b.opened_at));
}
