import { z } from "zod";
import { Constants } from "@/lib/supabase/database.types";
import { emptyToUndefined, optionalText } from "@/lib/validation/common";

const MILESTONES = Constants.public.Enums.milestone_type;
const LOCATION_KINDS = Constants.public.Enums.location_kind;

/** An ISO timestamp produced by the browser from the local date/time input. */
const eventTime = z.iso.datetime({ offset: true, error: "Enter when it happened" });

export const recordMilestoneSchema = z.object({
  milestone: z.enum(MILESTONES, { error: "Choose a milestone" }),
  eventAt: eventTime,
  containerIds: z.array(z.uuid()).max(50),
  location: optionalText(200),
  locationKind: z.preprocess(emptyToUndefined, z.enum(LOCATION_KINDS).optional()),
  publicNote: optionalText(2000),
  internalNote: optionalText(2000),
  sealNumber: optionalText(50),
  clientVisible: z.boolean(),
  evidenceIds: z.array(z.uuid()).max(20),
  overrideReason: z.preprocess(emptyToUndefined,
    z.string().trim().min(5, "Explain why the normal order is skipped (at least 5 characters)").max(500).optional()),
  idempotencyKey: z.uuid(),
});
export type RecordMilestoneInput = z.infer<typeof recordMilestoneSchema>;

export const correctMilestoneSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("cancel"),
    reason: z.string().trim().min(3, "Give a reason").max(500),
  }),
  z.object({
    mode: z.literal("correct"),
    reason: z.string().trim().min(3, "Give a reason").max(500),
    eventAt: z.preprocess(emptyToUndefined, eventTime.optional()),
    location: z.preprocess((v) => (typeof v === "string" ? v : undefined), z.string().trim().max(200).optional()),
    publicNote: z.preprocess((v) => (typeof v === "string" ? v : undefined), z.string().trim().max(2000).optional()),
  }),
]);
