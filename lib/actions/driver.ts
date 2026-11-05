"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireDriver } from "@/lib/dal/session";
import { getDriverJob } from "@/lib/dal/driver";
import { createClient } from "@/lib/supabase/server";
import { DRIVER_STEPS } from "@/lib/domain/driver";
import { fieldErrors, optionalText, type ActionState } from "@/lib/validation/common";

/*
 * Driver actions. Each one re-checks the session (driver role) and that the
 * job is the driver's own active truck assignment; the database checks it
 * again (0020: own containers only, no client-facing notes) together with the
 * milestone rules. Errors from those functions are written for users.
 */

function dbError(error: { code?: string; message: string }, fallback: string): string {
  if (["55000", "22023", "42501", "P0002"].includes(error.code ?? "")) return error.message;
  return fallback;
}

const stepSchema = z.object({
  milestone: z.enum(DRIVER_STEPS as [string, ...string[]], { error: "Choose what happened" }),
  eventAt: z.iso.datetime({ offset: true, error: "Enter when it happened" }),
  containerIds: z.array(z.uuid()).min(1, "Choose at least one container").max(10),
  location: optionalText(200),
  note: optionalText(1000),
  evidenceIds: z.array(z.uuid()).max(10),
  idempotencyKey: z.uuid(),
});

export type DriverStepState = (NonNullable<ActionState> & { recorded?: number }) | undefined;

/** Record a road milestone (checkpoint, border, arrival, offloading, delivery) for containers on this truck. */
export async function recordDriverStep(assignmentId: string, prev: DriverStepState, fd: FormData): Promise<DriverStepState> {
  await requireDriver();
  const job = await getDriverJob(assignmentId);
  if (!job) return { ...prev, ok: false, error: "This job is no longer assigned to you." };

  const str = (k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)) : undefined);
  const parsed = stepSchema.safeParse({
    milestone: str("milestone"),
    eventAt: str("event_at"),
    containerIds: fd.getAll("container_ids").map(String),
    location: str("location"),
    note: str("note"),
    evidenceIds: fd.getAll("evidence_ids").map(String),
    idempotencyKey: str("idempotency_key"),
  });
  if (!parsed.success) return { ...prev, ok: false, error: undefined, fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const own = new Set(job.containers.map((c) => c.id));
  if (!v.containerIds.every((id) => own.has(id))) {
    return { ...prev, ok: false, fieldErrors: { containerIds: ["Choose containers on your truck"] } };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_milestone", {
    p_shipment_id: job.shipment_id,
    p_milestone: v.milestone as (typeof DRIVER_STEPS)[number],
    p_event_at: v.eventAt,
    p_container_ids: v.containerIds,
    p_location: v.location,
    p_location_kind: v.milestone === "arrived" || v.milestone === "delivered" ? "destination" : "in_transit",
    p_internal_note: v.note,
    p_evidence_document_ids: v.evidenceIds.length ? v.evidenceIds : undefined,
    p_idempotency_key: v.idempotencyKey,
  });
  if (error) return { ...prev, ok: false, fieldErrors: undefined, error: dbError(error, "It could not be saved. Check your connection and try again.") };
  refresh();
  return { ok: true, recorded: (prev?.recorded ?? 0) + 1, message: "Saved. NGB and the client can see the update." };
}

const reportSchema = z.object({
  message: z.string().trim().min(3, "Describe the problem").max(1000, "Keep it under 1000 characters"),
  containerIds: z.array(z.uuid()).max(10),
  idempotencyKey: z.uuid(),
});

export type ReportState = (NonNullable<ActionState> & { sent?: number }) | undefined;

/** Tell NGB about a problem on the road. Staff only; never shown to the client. */
export async function reportProblem(assignmentId: string, prev: ReportState, fd: FormData): Promise<ReportState> {
  await requireDriver();
  const job = await getDriverJob(assignmentId);
  if (!job) return { ...prev, ok: false, error: "This job is no longer assigned to you." };
  const parsed = reportSchema.safeParse({
    message: fd.get("message") ?? "",
    containerIds: fd.getAll("container_ids").map(String),
    idempotencyKey: fd.get("idempotency_key"),
  });
  if (!parsed.success) return { ...prev, ok: false, error: undefined, fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("driver_report_problem", {
    p_assignment_id: assignmentId,
    p_message: parsed.data.message,
    p_container_ids: parsed.data.containerIds.length ? parsed.data.containerIds : undefined,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return { ...prev, ok: false, fieldErrors: undefined, error: dbError(error, "It could not be sent. Check your connection and try again.") };
  refresh();
  return { ok: true, sent: (prev?.sent ?? 0) + 1, message: "Sent to NGB operations. They will contact you." };
}

/** The driver's own choice to share name and phone with the client (the client's policy must allow it too). */
export async function setMyContactSharing(assignmentId: string, share: boolean): Promise<void> {
  await requireDriver();
  if (!z.uuid().safeParse(assignmentId).success) return;
  const supabase = await createClient();
  await supabase.rpc("set_my_contact_sharing", { p_assignment_id: assignmentId, p_share: share });
  refresh();
}
