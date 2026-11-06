import { z } from "zod";
import { Constants } from "@/lib/supabase/database.types";
import { optionalText } from "@/lib/validation/common";
import { CONDITIONS } from "@/lib/domain/closure";

const reason = (what: string, min = 5) =>
  z.string({ error: `Give ${what}` }).trim().min(min, { error: `Give ${what} (at least ${min} characters)` }).max(1000);

export const returnTermsSchema = z.object({
  containerIds: z.array(z.uuid()).min(1, { error: "Choose at least one container" }),
  deadline: z.iso.datetime({ offset: true, error: "Enter the return deadline" }),
  depot: optionalText(200),
  charges: optionalText(500),
});

export const conditionSchema = z.object({
  condition: z.enum(CONDITIONS, { error: "Choose the condition" }),
  note: optionalText(1000),
}).refine((v) => !(v.condition === "minor_damage" || v.condition === "damaged") || (v.note?.length ?? 0) >= 5,
  { message: "Describe the damage", path: ["note"] });

export const incidentSchema = z.object({
  type: z.enum(Constants.public.Enums.incident_type, { error: "Choose the type of incident" }),
  containerId: z.preprocess((v) => (v === "" ? undefined : v), z.uuid().optional()),
  description: z.string({ error: "Describe what happened" }).trim().min(5, { error: "Describe what happened (at least 5 characters)" }).max(2000),
  evidence: z.array(z.uuid()).max(20),
});

export const noteSchema = z.object({ note: z.string().trim().min(1, { error: "Write the comment" }).max(2000) });
export const resolutionSchema = z.object({ resolution: reason("the outcome of the review").pipe(z.string().max(2000)) });
export const creditSchema = z.object({ reason: reason("the reason and terms of the credit") });
export const closeSchema = z.object({ note: optionalText(1000) });
export const reopenSchema = z.object({ reason: reason("the reason for reopening") });
