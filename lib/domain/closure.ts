import type { AppRole } from "@/lib/auth/roles";
import type { Database } from "@/lib/supabase/database.types";

/* Return, incidents and closure (0024). These mirror the database functions, which are the authority. */

export type IncidentType = Database["public"]["Enums"]["incident_type"];
export type ContainerCondition = "sound" | "needs_cleaning" | "minor_damage" | "damaged";

export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  seal_damaged: "Seal damaged or different",
  cargo_damage: "Cargo damage",
  cargo_shortage: "Cargo shortage",
  container_damage: "Container damage",
  delivery_discrepancy: "Delivery discrepancy",
  other: "Other",
};

export const CONDITION_LABELS: Record<ContainerCondition, string> = {
  sound: "Sound",
  needs_cleaning: "Needs cleaning",
  minor_damage: "Minor damage",
  damaged: "Damaged",
};
export const CONDITIONS = Object.keys(CONDITION_LABELS) as ContainerCondition[];
export const isDamage = (c: string | null | undefined) => c === "minor_damage" || c === "damaged";

const has = (r: AppRole, ...roles: AppRole[]) => roles.includes(r);
export const canSetReturnTerms = (r: AppRole) => has(r, "admin", "ops_manager", "transport_coord", "doc_officer");
export const canRecordCondition = (r: AppRole) => has(r, "admin", "ops_manager", "transport_coord");
export const canReportIncident = (r: AppRole) => has(r, "admin", "ops_manager", "doc_officer", "clearing_agent", "transport_coord");
export const canResolveIncident = (r: AppRole) => has(r, "admin", "ops_manager");
export const canCloseShipment = (r: AppRole) => has(r, "admin", "ops_manager");
export const canApproveCredit = (r: AppRole) => has(r, "finance", "admin");
/** Who sees the closure section (office staff; not drivers or clients). */
export const canSeeClosure = (r: AppRole) => r !== "driver" && r !== "client";
