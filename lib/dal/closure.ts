import "server-only";
import { createClient } from "@/lib/supabase/server";

/*
 * Incidents, credit approvals, closure checklist and log for one shipment, AS THE
 * SIGNED-IN USER. RLS (0024): office staff with access to the shipment only.
 */
export async function getClosureData(shipmentId: string) {
  const supabase = await createClient();
  const [checks, incidents, credits, log] = await Promise.all([
    supabase.rpc("closure_checks", { p_shipment_id: shipmentId }),
    supabase.from("incidents")
      .select(`id, incident_type, description, status, reported_at, resolution, resolved_at, container_id, evidence_document_ids,
        reporter:profiles!incidents_reported_by_fkey(full_name), resolver:profiles!incidents_resolved_by_fkey(full_name),
        notes:incident_notes(id, note, created_at, author:profiles!incident_notes_created_by_fkey(full_name))`)
      .eq("shipment_id", shipmentId).order("reported_at", { ascending: false }),
    supabase.from("closure_credit_approvals")
      .select("id, reason, approved_at, approver:profiles!closure_credit_approvals_approved_by_fkey(full_name)")
      .eq("shipment_id", shipmentId).order("approved_at", { ascending: false }),
    supabase.from("shipment_closure_log")
      .select("id, action, note, occurred_at, actor:profiles!shipment_closure_log_actor_id_fkey(full_name)")
      .eq("shipment_id", shipmentId).order("occurred_at", { ascending: false }),
  ]);
  if (checks.error || incidents.error || credits.error || log.error) throw new Error("Could not load closure details");
  return {
    checks: checks.data,
    incidents: incidents.data.map((i) => ({ ...i, notes: [...i.notes].sort((a, b) => a.created_at.localeCompare(b.created_at)) })),
    credits: credits.data,
    log: log.data,
  };
}
export type ClosureData = Awaited<ReturnType<typeof getClosureData>>;
export type Incident = ClosureData["incidents"][number];
