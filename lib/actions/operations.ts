"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/dal/session";
import { createClient } from "@/lib/supabase/server";
import {
  assignTransportSchema, cancelTransportSchema, exceptionActionSchema, openExceptionSchema, reviseEtaSchema,
} from "@/lib/validation/operations";
import { fieldErrors, type ActionState } from "@/lib/validation/common";

/*
 * ETA, transport and exception actions. Each one validates the form, then calls
 * the database function as the signed-in user; the function checks the role,
 * shipment access and the business rules (it is the authority).
 */

export type OpsState = ActionState;

const text = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};
/** Messages raised by our database functions are written for users; others are not shown. */
function dbError(error: { code?: string; message: string }, fallback: string) {
  return ["55000", "22023", "42501", "P0002"].includes(error.code ?? "") ? error.message : fallback;
}
const LEADS_AND_FIELD = ["admin", "ops_manager", "doc_officer", "clearing_agent", "transport_coord"] as const;

export async function reviseEta(shipmentId: string, _prev: OpsState, fd: FormData): Promise<OpsState> {
  await requireStaff(...LEADS_AND_FIELD);
  const parsed = reviseEtaSchema.safeParse({
    newEta: text(fd, "new_eta"), category: text(fd, "category"), reason: text(fd, "reason") ?? "",
    clientVisible: fd.get("client_visible") === "on",
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revise_eta", {
    p_shipment_id: shipmentId, p_new_eta: v.newEta, p_reason_category: v.category, p_reason: v.reason,
    p_client_visible: v.clientVisible,
  });
  if (error) return { error: dbError(error, "The ETA could not be saved. Please try again.") };
  refresh();
  const material = data?.[0]?.material;
  return {
    ok: true,
    message: material
      ? `ETA updated. This is a material change${v.clientVisible ? "; the client will be notified" : ""}.`
      : "ETA updated. The change is below the notification threshold.",
  };
}

export async function assignTransport(shipmentId: string, _prev: OpsState, fd: FormData): Promise<OpsState> {
  await requireStaff("admin", "ops_manager", "transport_coord");
  const parsed = assignTransportSchema.safeParse({
    containerIds: fd.getAll("container_ids").map(String),
    transporter: text(fd, "transporter") ?? "", truck: text(fd, "truck") ?? "", trailer: text(fd, "trailer"),
    driverName: text(fd, "driver_name"), driverPhone: text(fd, "driver_phone"), driverUserId: text(fd, "driver_user_id"),
    routeId: text(fd, "route_id"), plannedLoadingAt: text(fd, "planned_loading_at"),
    transitRefs: text(fd, "transit_refs") ?? "", overrideReason: text(fd, "override_reason"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_transport", {
    p_shipment_id: shipmentId, p_container_ids: v.containerIds, p_transporter_name: v.transporter,
    p_truck_registration: v.truck, p_trailer_registration: v.trailer, p_driver_name: v.driverName,
    p_driver_phone: v.driverPhone, p_driver_user_id: v.driverUserId, p_route_id: v.routeId,
    p_planned_loading_at: v.plannedLoadingAt, p_transit_document_refs: v.transitRefs,
    p_override_reason: v.overrideReason,
  });
  if (error) return { error: dbError(error, "The truck could not be assigned. Please try again.") };
  refresh();
  return { ok: true, message: `Truck ${v.truck} assigned.` };
}

export async function cancelTransport(assignmentId: string, _prev: OpsState, fd: FormData): Promise<OpsState> {
  await requireStaff("admin", "ops_manager", "transport_coord");
  const parsed = cancelTransportSchema.safeParse({ reason: text(fd, "reason") ?? "" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_transport_assignment", { p_assignment_id: assignmentId, p_reason: parsed.data.reason });
  if (error) return { error: dbError(error, "The assignment could not be cancelled. Please try again.") };
  refresh();
  return { ok: true, message: "Truck assignment cancelled." };
}

const EXCEPTION_ROLES = ["admin", "ops_manager", "doc_officer", "clearing_agent", "transport_coord", "finance"] as const;

export async function openException(shipmentId: string, _prev: OpsState, fd: FormData): Promise<OpsState> {
  await requireStaff(...EXCEPTION_ROLES);
  const parsed = openExceptionSchema.safeParse({
    type: text(fd, "type"), severity: text(fd, "severity") ?? "medium", title: text(fd, "title") ?? "",
    details: text(fd, "details"), containerId: text(fd, "container_id"), ownerId: text(fd, "owner_id"),
    nextAction: text(fd, "next_action"), followUpAt: text(fd, "follow_up_at"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("open_exception", {
    p_shipment_id: shipmentId, p_type: v.type, p_title: v.title, p_severity: v.severity, p_details: v.details,
    p_container_id: v.containerId, p_owner_id: v.ownerId, p_next_action: v.nextAction, p_next_follow_up_at: v.followUpAt,
  });
  if (error) return { error: dbError(error, "The exception could not be opened. Please try again.") };
  refresh();
  return { ok: true, message: "Exception opened." };
}

/** Follow up (note / next action / owner / severity), escalate or resolve: the form's "op" field decides. */
export async function actOnException(exceptionId: string, _prev: OpsState, fd: FormData): Promise<OpsState> {
  await requireStaff(...EXCEPTION_ROLES);
  const parsed = exceptionActionSchema.safeParse({
    op: text(fd, "op"), note: text(fd, "note") ?? (text(fd, "op") === "escalate" ? "" : undefined),
    nextAction: text(fd, "next_action"), followUpAt: text(fd, "follow_up_at"), ownerId: text(fd, "owner_id"),
    severity: text(fd, "severity"), resolution: text(fd, "resolution") ?? "",
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } =
    v.op === "update"
      ? await supabase.rpc("update_exception", {
          p_exception_id: exceptionId, p_note: v.note, p_next_action: v.nextAction, p_next_follow_up_at: v.followUpAt,
          p_owner_id: v.ownerId, p_severity: v.severity })
      : v.op === "escalate"
        ? await supabase.rpc("escalate_exception", { p_exception_id: exceptionId, p_note: v.note })
        : await supabase.rpc("resolve_exception", { p_exception_id: exceptionId, p_resolution: v.resolution });
  if (error) return { error: dbError(error, "The change could not be saved. Please try again.") };
  refresh();
  return { ok: true, message: v.op === "update" ? "Exception updated." : v.op === "escalate" ? "Escalated to the operations manager." : "Exception resolved." };
}

/** Run the SLA check now (operations manager / admin). Returns to the queue with a summary. */
export async function runSlaCheck(): Promise<void> {
  await requireStaff("admin", "ops_manager");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("run_sla_scan");
  if (error) redirect("/admin/exceptions?scan=failed");
  const r = data?.[0];
  redirect(`/admin/exceptions?scan=${r?.opened ?? 0}-${r?.escalated ?? 0}-${r?.cleared ?? 0}`);
}
