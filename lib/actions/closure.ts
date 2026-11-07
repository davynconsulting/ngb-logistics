"use server";

import { refresh } from "next/cache";
import { requireStaff } from "@/lib/dal/session";
import { createClient } from "@/lib/supabase/server";
import {
  closeSchema, conditionSchema, creditSchema, incidentSchema, noteSchema, reopenSchema, resolutionSchema, returnTermsSchema,
} from "@/lib/validation/closure";
import { fieldErrors, type ActionState } from "@/lib/validation/common";

/*
 * Container return, incidents, credit approval, closure and reopening (0024).
 * Each action checks the role, validates the form and calls the database
 * function as the signed-in user; the function re-checks everything.
 */

export type ClosureState = ActionState;

const text = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};
function dbError(error: { code?: string; message: string }, fallback: string) {
  return ["55000", "22023", "42501", "P0002"].includes(error.code ?? "") ? error.message : fallback;
}
const OFFICE = ["admin", "ops_manager", "doc_officer", "clearing_agent", "transport_coord"] as const;
const LEADS = ["admin", "ops_manager"] as const;

export async function setReturnTerms(_prev: ClosureState, fd: FormData): Promise<ClosureState> {
  await requireStaff("admin", "ops_manager", "transport_coord", "doc_officer");
  const parsed = returnTermsSchema.safeParse({
    containerIds: fd.getAll("container_ids").map(String), deadline: text(fd, "deadline"),
    depot: text(fd, "depot"), charges: text(fd, "charges"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_container_return_terms", {
    p_container_ids: v.containerIds, p_return_deadline: v.deadline, p_return_depot: v.depot, p_charges_note: v.charges,
  });
  if (error) return { error: dbError(error, "The return terms could not be saved. Please try again.") };
  refresh();
  return { ok: true, message: "Return terms saved." };
}

export async function recordCondition(containerId: string, _prev: ClosureState, fd: FormData): Promise<ClosureState> {
  await requireStaff("admin", "ops_manager", "transport_coord");
  const parsed = conditionSchema.safeParse({ condition: text(fd, "condition"), note: text(fd, "note") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_container_condition", {
    p_container_id: containerId, p_condition: parsed.data.condition, p_note: parsed.data.note,
  });
  if (error) return { error: dbError(error, "The condition could not be saved. Please try again.") };
  refresh();
  return { ok: true, message: data ? "Condition saved. An incident was opened for the damage." : "Condition saved." };
}

export async function reportIncident(shipmentId: string, _prev: ClosureState, fd: FormData): Promise<ClosureState> {
  await requireStaff(...OFFICE);
  const parsed = incidentSchema.safeParse({
    type: text(fd, "type"), containerId: text(fd, "container_id"), description: text(fd, "description"),
    evidence: fd.getAll("evidence").map(String),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("report_incident", {
    p_shipment_id: shipmentId, // null (not undefined): an omitted argument makes PostgREST miss the function
    p_container_id: (v.containerId ?? null) as string, p_type: v.type, p_description: v.description, p_evidence: v.evidence,
  });
  if (error) return { error: dbError(error, "The incident could not be saved. Please try again.") };
  refresh();
  return { ok: true, message: "Incident recorded. It must be reviewed before the shipment can close." };
}

export async function addIncidentNote(incidentId: string, _prev: ClosureState, fd: FormData): Promise<ClosureState> {
  await requireStaff(...OFFICE);
  const parsed = noteSchema.safeParse({ note: text(fd, "note") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_incident_note", { p_incident_id: incidentId, p_note: parsed.data.note });
  if (error) return { error: dbError(error, "The comment could not be saved. Please try again.") };
  refresh();
  return { ok: true, message: "Comment added." };
}

export async function resolveIncident(incidentId: string, _prev: ClosureState, fd: FormData): Promise<ClosureState> {
  await requireStaff(...LEADS);
  const parsed = resolutionSchema.safeParse({ resolution: text(fd, "resolution") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_incident", { p_incident_id: incidentId, p_resolution: parsed.data.resolution });
  if (error) return { error: dbError(error, "The incident could not be resolved. Please try again.") };
  refresh();
  return { ok: true, message: "Incident resolved." };
}

export async function approveCredit(shipmentId: string, _prev: ClosureState, fd: FormData): Promise<ClosureState> {
  await requireStaff("finance", "admin");
  const parsed = creditSchema.safeParse({ reason: text(fd, "reason") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_closure_credit", { p_shipment_id: shipmentId, p_reason: parsed.data.reason });
  if (error) return { error: dbError(error, "The credit approval could not be saved. Please try again.") };
  refresh();
  return { ok: true, message: "Credit approved for closure." };
}

export async function closeShipment(shipmentId: string, _prev: ClosureState, fd: FormData): Promise<ClosureState> {
  await requireStaff(...LEADS);
  const parsed = closeSchema.safeParse({ note: text(fd, "note") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_shipment", { p_shipment_id: shipmentId, p_note: parsed.data.note });
  if (error) return { error: dbError(error, "The shipment could not be closed. Please try again.") };
  refresh();
  return { ok: true, message: "Shipment closed. The client has been notified." };
}

export async function reopenShipment(shipmentId: string, _prev: ClosureState, fd: FormData): Promise<ClosureState> {
  await requireStaff(...LEADS);
  const parsed = reopenSchema.safeParse({ reason: text(fd, "reason") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_shipment", { p_shipment_id: shipmentId, p_reason: parsed.data.reason });
  if (error) return { error: dbError(error, "The shipment could not be reopened. Please try again.") };
  refresh();
  return { ok: true, message: "Shipment reopened. The reason is in the closure log." };
}
