import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Shipment reads. Queries run AS THE SIGNED-IN USER, so Row Level Security
 * limits results: clients get only their organization's shipments, clearing
 * agents and drivers only assigned ones, other staff everything.
 */
export async function listShipments({ limit = 50 }: { limit?: number } = {}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shipments")
    .select(
      `id, shipment_reference, bl_number, cargo_description, overall_status, has_open_exception,
       destination_city, destination_country, planned_vessel_arrival, current_eta, created_at,
       client:organizations!shipments_client_id_fkey(legal_name, client_code),
       origin:ports(name),
       containers(count)`,
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("Could not load shipments");
  return data;
}

export type ShipmentListItem = Awaited<ReturnType<typeof listShipments>>[number];

/** Counts for the staff overview (RLS still applies). */
export async function getStaffOverview() {
  const supabase = await createClient();
  const head = { count: "exact" as const, head: true };
  const [shipments, clients, containers, missingDocs] = await Promise.all([
    supabase.from("shipments").select("id", head),
    supabase.from("organizations").select("id", head).eq("is_internal", false),
    supabase.from("containers").select("id", head),
    supabase.from("document_requirements").select("id", head).eq("status", "missing").eq("is_required", true),
  ]);
  return {
    shipments: shipments.count ?? 0,
    clients: clients.count ?? 0,
    containers: containers.count ?? 0,
    missingDocuments: missingDocs.count ?? 0,
  };
}

/** Staff shipment list with optional search and client filter. */
export async function searchShipments({ q, clientId, limit = 100 }: { q?: string; clientId?: string; limit?: number }) {
  const supabase = await createClient();
  let query = supabase
    .from("shipments")
    .select(
      `id, shipment_reference, bl_number, cargo_description, overall_status, has_open_exception,
       destination_city, destination_country, planned_vessel_arrival, current_eta, created_at,
       client:organizations!shipments_client_id_fkey(legal_name, client_code),
       origin:ports(name),
       containers(count)`,
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (clientId) query = query.eq("client_id", clientId);
  const term = q?.trim().replace(/[%_,()*\\]/g, "");
  if (term) {
    query = query.or(
      `shipment_reference.ilike.%${term}%,bl_number.ilike.%${term}%,booking_reference.ilike.%${term}%,cargo_description.ilike.%${term}%`,
    );
  }
  const { data, error } = await query;
  if (error) throw new Error("Could not load shipments");
  return data;
}

/** One shipment with containers, checklist and documents (null if not visible to the user). */
export async function getShipment(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shipments")
    .select(
      `*,
       client:organizations!shipments_client_id_fkey(id, legal_name, client_code, timezone),
       origin:ports(name, code),
       owner:profiles!shipments_assigned_ops_user_id_fkey(full_name, email),
       containers(id, container_number, size_type, seal_number, operational_status, transport_status, delivery_status,
         return_status, location_kind, location_name, discharge_at, gate_out_at, delivery_at, empty_return_at),
       document_requirements(id, document_type, is_required, status, client_note, due_date),
       documents(id, document_type, container_id, file_name, mime_type, size_bytes, uploaded_at, verification_status,
         verified_at, rejection_reason, client_visible, version, replaces_document_id,
         uploader:profiles!documents_uploaded_by_fkey(full_name),
         reviewer:profiles!documents_verified_by_fkey(full_name))`,
    )
    .eq("id", id)
    .order("uploaded_at", { referencedTable: "documents", ascending: false })
    .order("container_number", { referencedTable: "containers" })
    .maybeSingle();
  if (error) throw new Error("Could not load shipment");
  return data;
}

export type ShipmentDetail = NonNullable<Awaited<ReturnType<typeof getShipment>>>;
