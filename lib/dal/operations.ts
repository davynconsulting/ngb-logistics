import "server-only";
import { createClient } from "@/lib/supabase/server";

/*
 * ETA, transport and exception reads AS THE SIGNED-IN USER. RLS decides:
 * driver contacts are staff-only, exceptions are staff-only (not drivers),
 * agents/drivers see assigned shipments only.
 */

export async function getEtaHistory(shipmentId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("eta_revisions")
    .select("id, previous_eta, new_eta, change_minutes, reason_category, reason, is_material, client_visible, revised_at, revised_by_profile:profiles!eta_revisions_revised_by_fkey(full_name)")
    .eq("shipment_id", shipmentId).order("revised_at", { ascending: false }).limit(100);
  if (error) throw new Error("Could not load ETA history");
  return data;
}
export type EtaRevision = Awaited<ReturnType<typeof getEtaHistory>>[number];

export async function getTransport(shipmentId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("transport_assignments")
    .select(`id, transporter_name, truck_registration, trailer_registration, border_crossing, planned_loading_at,
      actual_loading_at, transit_document_refs, status, assigned_at, cancel_reason, cancelled_at,
      route:routes(code, name, transit_estimate_hours),
      driver:driver_contacts(driver_name, driver_phone),
      containers:transport_assignment_containers(container_id)`)
    .eq("shipment_id", shipmentId).order("assigned_at", { ascending: false });
  if (error) throw new Error("Could not load transport");
  return data;
}
export type TransportAssignment = Awaited<ReturnType<typeof getTransport>>[number];

export async function listRoutes() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("routes")
    .select("id, code, name, border_crossing, transit_estimate_hours").eq("is_active", true).order("code");
  if (error) throw new Error("Could not load routes");
  return data;
}

export async function listDrivers() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles")
    .select("id, full_name, email").eq("role", "driver").eq("is_active", true).order("full_name");
  if (error) throw new Error("Could not load drivers");
  return data;
}

/** Adds follow_up_due (follow-up time has passed) so components stay pure. */
function withDue<T extends { next_follow_up_at: string | null; status: string }>(rows: T[]) {
  const now = Date.now();
  return rows.map((r) => ({ ...r, follow_up_due: r.status === "open" && !!r.next_follow_up_at && new Date(r.next_follow_up_at).getTime() < now }));
}

const EXCEPTION_FIELDS = `id, shipment_id, container_id, exception_type, severity, status, title, details, client_message,
  owner_id, source, next_action, next_follow_up_at, opened_at, escalated_at, resolved_at, resolution, sla_stage,
  owner:profiles!exceptions_owner_id_fkey(full_name, email),
  container:containers(container_number),
  last_event:milestone_events!exceptions_last_event_id_fkey(milestone_type, event_at)`;

export async function getShipmentExceptions(shipmentId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("exceptions")
    .select(`${EXCEPTION_FIELDS}, updates:exception_updates(id, kind, note, data, created_at, by:profiles!exception_updates_created_by_fkey(full_name))`)
    .eq("shipment_id", shipmentId)
    .order("opened_at", { ascending: false })
    .order("created_at", { referencedTable: "exception_updates", ascending: true });
  if (error) throw new Error("Could not load exceptions");
  return withDue(data);
}
export type ShipmentException = Awaited<ReturnType<typeof getShipmentExceptions>>[number];

/** Operational queue (AC-10): open exceptions with owner, last event and next action. */
export async function listOpenExceptions({ filter, userId }: { filter: "open" | "mine" | "escalated" | "due"; userId: string }) {
  const supabase = await createClient();
  let q = supabase.from("exceptions")
    .select(`${EXCEPTION_FIELDS}, shipment:shipments(shipment_reference, client:organizations!shipments_client_id_fkey(legal_name))`)
    .eq("status", "open").limit(300);
  if (filter === "mine") q = q.eq("owner_id", userId);
  if (filter === "escalated") q = q.not("escalated_at", "is", null);
  if (filter === "due") q = q.lte("next_follow_up_at", new Date().toISOString());
  const { data, error } = await q;
  if (error) throw new Error("Could not load exceptions");
  return withDue(data);
}
export type QueueException = Awaited<ReturnType<typeof listOpenExceptions>>[number];

export async function countOpenExceptions() {
  const supabase = await createClient();
  const head = { count: "exact" as const, head: true };
  const [open, escalated] = await Promise.all([
    supabase.from("exceptions").select("id", head).eq("status", "open"),
    supabase.from("exceptions").select("id", head).eq("status", "open").not("escalated_at", "is", null),
  ]);
  return { open: open.count ?? 0, escalated: escalated.count ?? 0 };
}
