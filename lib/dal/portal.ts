import "server-only";
import { createClient } from "@/lib/supabase/server";

/*
 * Client portal reads, AS THE SIGNED-IN CLIENT. RLS limits every query to the
 * client's organization; milestones, trucks and alerts come from the
 * client-safe functions (migration 0015), never from the staff tables.
 * Columns are listed explicitly: no `*`, so nothing internal is fetched.
 */

const SHIPMENT_CARD = `id, shipment_reference, bl_number, cargo_description, overall_status, current_eta,
  destination_city, destination_country, planned_vessel_arrival, created_at, closed_at,
  origin:ports(name), containers(count)`;

const DONE = ["operationally_complete", "closed"] as const;

export async function getPortalDashboard() {
  const supabase = await createClient();
  const [shipments, actions, notes, unread] = await Promise.all([
    supabase.from("shipments").select(SHIPMENT_CARD).not("overall_status", "in", `(${DONE.join(",")})`)
      .order("current_eta", { ascending: true, nullsFirst: false }).limit(50),
    supabase.from("document_requirements")
      .select("id, document_type, status, client_note, due_date, shipment:shipments!inner(id, shipment_reference, overall_status)")
      .eq("is_required", true).in("status", ["missing", "rejected"])
      .not("shipment.overall_status", "in", `(${DONE.join(",")})`)
      .order("due_date", { ascending: true, nullsFirst: false }).limit(50),
    supabase.from("notifications").select("id, template_key, payload, shipment_id, created_at, read_at")
      .order("created_at", { ascending: false }).limit(5),
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  if (shipments.error || actions.error || notes.error) throw new Error("Could not load the dashboard");
  return { shipments: shipments.data, actions: actions.data, notifications: notes.data, unread: unread.count ?? 0 };
}
export type PortalDashboard = Awaited<ReturnType<typeof getPortalDashboard>>;
export type PortalShipmentCard = PortalDashboard["shipments"][number];

export async function listClientShipments(view: "active" | "completed" | "all") {
  const supabase = await createClient();
  let q = supabase.from("shipments").select(SHIPMENT_CARD).order("created_at", { ascending: false }).limit(200);
  if (view === "active") q = q.not("overall_status", "in", `(${DONE.join(",")})`);
  if (view === "completed") q = q.in("overall_status", [...DONE]);
  const { data, error } = await q;
  if (error) throw new Error("Could not load shipments");
  return data;
}

/** One shipment by its reference, or null if it does not exist or is not the client's (RLS). */
export async function getClientShipment(reference: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("shipments")
    .select(`id, shipment_reference, bl_number, booking_reference, shipping_line, vessel_name, voyage_number,
      cargo_description, package_count, gross_weight_kg, origin_terminal, destination_city, destination_country,
      delivery_address, planned_vessel_arrival, actual_vessel_arrival, overall_status, doc_status, customs_status,
      transport_status, delivery_status, return_status, current_eta, eta_updated_at, eta_reason, created_at, closed_at,
      client:organizations!shipments_client_id_fkey(timezone),
      origin:ports(name),
      containers(id, container_number, size_type, seal_number, operational_status, delivery_status, return_status,
        location_kind, location_name, discharge_at, gate_out_at, delivery_at, empty_return_at,
        return_deadline, return_depot, return_charges_note),
      document_requirements(id, document_type, is_required, status, client_note, due_date),
      documents(id, document_type, container_id, file_name, mime_type, size_bytes, uploaded_at, verification_status,
        verified_at, rejection_reason, client_visible, version, replaces_document_id,
        uploader:profiles!documents_uploaded_by_fkey(full_name),
        reviewer:profiles!documents_verified_by_fkey(full_name))`)
    .eq("shipment_reference", reference)
    .order("container_number", { referencedTable: "containers" })
    .order("uploaded_at", { referencedTable: "documents", ascending: false })
    .maybeSingle();
  if (error) throw new Error("Could not load the shipment");
  if (!data) return null;

  const [timeline, transport, alerts, eta] = await Promise.all([
    supabase.rpc("client_timeline", { p_shipment_id: data.id }),
    supabase.rpc("client_transport", { p_shipment_id: data.id }),
    supabase.rpc("client_shipment_alerts", { p_shipment_id: data.id }),
    supabase.from("eta_revisions").select("id, previous_eta, new_eta, reason, revised_at")
      .eq("shipment_id", data.id).order("revised_at", { ascending: false }).limit(20),
  ]);
  if (timeline.error || transport.error || alerts.error || eta.error) throw new Error("Could not load the shipment");
  return { ...data, timeline: timeline.data, transport: transport.data, alerts: alerts.data, etaHistory: eta.data };
}
export type ClientShipment = NonNullable<Awaited<ReturnType<typeof getClientShipment>>>;

export async function listNotifications({ limit = 50, before }: { limit?: number; before?: string } = {}) {
  const supabase = await createClient();
  let q = supabase.from("notifications").select("id, template_key, payload, shipment_id, created_at, read_at")
    .order("created_at", { ascending: false }).limit(limit);
  if (before) q = q.lt("created_at", before);
  const { data, error } = await q;
  if (error) throw new Error("Could not load notifications");
  return data;
}
export type InboxItem = Awaited<ReturnType<typeof listNotifications>>[number];

export async function countUnread() {
  const supabase = await createClient();
  const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  return count ?? 0;
}

export async function getMyPreferences(userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("notification_preferences")
    .select("push_enabled, whatsapp_opt_in, whatsapp_phone, consent_at, consent_source, locale")
    .eq("user_id", userId).maybeSingle();
  if (error) throw new Error("Could not load your settings");
  return data;
}

/** The client organization's display time zone (Africa/Kigali if unset). */
export async function getOrgTimezone(organizationId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("organizations").select("timezone").eq("id", organizationId).maybeSingle();
  return data?.timezone ?? "Africa/Kigali";
}
