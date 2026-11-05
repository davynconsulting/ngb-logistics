"use server";

import { refresh } from "next/cache";
import { requireStaff } from "@/lib/dal/session";
import { createClient } from "@/lib/supabase/server";
import { correctMilestoneSchema, recordMilestoneSchema } from "@/lib/validation/milestone";
import { fieldErrors, type ActionState } from "@/lib/validation/common";

/*
 * Milestones change shipment and container statuses, so both actions only call
 * the database functions record_milestone() / correct_milestone() as the
 * signed-in user. Those functions check the role, shipment access, the
 * transition rules and the override permission. The checks here only give
 * early, friendly feedback.
 */

const STAFF_RECORDERS = ["admin", "ops_manager", "doc_officer", "clearing_agent", "transport_coord", "driver"] as const;

/** Errors raised by the milestone functions are written for users; others are not shown. */
function dbError(error: { code?: string; message: string }, fallback: string): string {
  if (["55000", "22023", "42501", "P0002"].includes(error.code ?? "")) return error.message;
  if (error.code === "23505") return "This was just recorded. Reload the page to see it.";
  return fallback;
}

const text = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};

export type RecordMilestoneState = (NonNullable<ActionState> & { recorded?: number }) | undefined;

export async function recordMilestone(shipmentId: string, prev: RecordMilestoneState, formData: FormData): Promise<RecordMilestoneState> {
  await requireStaff(...STAFF_RECORDERS);
  const parsed = recordMilestoneSchema.safeParse({
    milestone: text(formData, "milestone"),
    eventAt: text(formData, "event_at"),
    containerIds: formData.getAll("container_ids").map(String),
    location: text(formData, "location"),
    locationKind: text(formData, "location_kind"),
    publicNote: text(formData, "public_note"),
    internalNote: text(formData, "internal_note"),
    sealNumber: text(formData, "seal_number"),
    clientVisible: formData.get("client_visible") === "on",
    evidenceIds: formData.getAll("evidence_ids").map(String),
    overrideReason: text(formData, "override_reason"),
    idempotencyKey: text(formData, "idempotency_key"),
  });
  if (!parsed.success) return { ...prev, error: undefined, ok: false, fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_milestone", {
    p_shipment_id: shipmentId,
    p_milestone: v.milestone,
    p_event_at: v.eventAt,
    p_container_ids: v.containerIds.length ? v.containerIds : undefined,
    p_location: v.location,
    p_location_kind: v.locationKind,
    p_public_note: v.publicNote,
    p_internal_note: v.internalNote,
    p_client_visible: v.clientVisible,
    p_evidence_document_ids: v.evidenceIds.length ? v.evidenceIds : undefined,
    p_seal_number: v.sealNumber,
    p_override_reason: v.overrideReason,
    p_idempotency_key: v.idempotencyKey,
  });
  if (error) return { ...prev, ok: false, fieldErrors: undefined, error: dbError(error, "The milestone could not be saved. Please try again.") };

  refresh();
  const n = data?.length ?? 0;
  return {
    ok: true,
    recorded: (prev?.recorded ?? 0) + 1,
    message: n > 1 ? `Milestone recorded for ${n} containers.` : "Milestone recorded.",
  };
}

export type CorrectMilestoneState = ActionState;

/** Correct the time/location/note of an event, or cancel it (mode = "cancel"). */
export async function correctMilestone(eventId: string, _prev: CorrectMilestoneState, formData: FormData): Promise<CorrectMilestoneState> {
  await requireStaff(...STAFF_RECORDERS);
  const parsed = correctMilestoneSchema.safeParse({
    mode: text(formData, "mode"),
    reason: text(formData, "reason") ?? "",
    eventAt: text(formData, "event_at"),
    location: formData.has("location") ? text(formData, "location") : undefined,
    publicNote: formData.has("public_note") ? text(formData, "public_note") : undefined,
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("correct_milestone", v.mode === "cancel"
    ? { p_event_id: eventId, p_reason: v.reason, p_void: true }
    : { p_event_id: eventId, p_reason: v.reason, p_void: false, p_event_at: v.eventAt, p_location: v.location, p_public_note: v.publicNote });
  if (error) return { error: dbError(error, "The correction could not be saved. Please try again.") };

  refresh();
  return { ok: true, message: v.mode === "cancel" ? "Milestone cancelled." : "Correction saved." };
}
