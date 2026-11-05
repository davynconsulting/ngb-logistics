import { z } from "zod";
import { Constants } from "@/lib/supabase/database.types";
import { emptyToUndefined, optionalText, optionalUuid } from "@/lib/validation/common";

const E = Constants.public.Enums;
const isoTime = z.iso.datetime({ offset: true });
const optionalTime = z.preprocess(emptyToUndefined, isoTime.optional());
const reason = (msg: string, max = 500) => z.string({ error: msg }).trim().min(3, msg).max(max);

export const reviseEtaSchema = z.object({
  newEta: z.iso.datetime({ offset: true, error: "Enter the new ETA" }),
  category: z.enum(E.eta_reason_category, { error: "Choose a reason" }),
  reason: reason("Explain the change (the client sees this)"),
  clientVisible: z.boolean(),
});

/** Uppercase, single spaces; letters, digits, space and dash only (e.g. "T 123 ABC"). */
const registration = (label: string) => z.string({ error: `Enter the ${label}` }).trim()
  .transform((v) => v.toUpperCase().replace(/\s+/g, " "))
  .pipe(z.string().regex(/^[A-Z0-9 -]{3,20}$/, { error: `Enter a valid ${label}` }));

export const assignTransportSchema = z.object({
  containerIds: z.array(z.uuid()).min(1, "Choose at least one container").max(50),
  transporter: z.string({ error: "Enter the transporter" }).trim().min(2, "Enter the transporter").max(120),
  truck: registration("truck registration"),
  trailer: z.preprocess(emptyToUndefined, registration("trailer registration").optional()),
  driverName: optionalText(120),
  driverPhone: z.preprocess(emptyToUndefined, z.string().transform((v) => v.replace(/[\s\-().]/g, ""))
    .pipe(z.string().regex(/^\+[1-9]\d{6,14}$/, { error: "Use international format, e.g. +250788123456" })).optional()),
  driverUserId: optionalUuid,
  routeId: optionalUuid,
  plannedLoadingAt: optionalTime,
  transitRefs: z.string().max(700).transform((v) => v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(z.string().max(60, "A reference is too long")).max(10, "At most 10 references")),
  overrideReason: z.preprocess(emptyToUndefined, reason("Explain why the normal order is skipped").optional()),
}).refine((v) => !(v.driverPhone || v.driverUserId) || v.driverName, { path: ["driverName"], error: "Enter the driver name" });

export const cancelTransportSchema = z.object({ reason: reason("Give a reason") });

export const openExceptionSchema = z.object({
  type: z.enum(E.exception_type, { error: "Choose the type" }),
  severity: z.enum(E.exception_severity),
  title: z.string({ error: "Enter a short title" }).trim().min(3, "Enter a short title").max(200),
  details: optionalText(2000),
  containerId: optionalUuid,
  ownerId: optionalUuid,
  nextAction: optionalText(500),
  followUpAt: optionalTime,
});

export const exceptionActionSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("update"),
    note: optionalText(2000),
    nextAction: optionalText(500),
    followUpAt: optionalTime,
    ownerId: optionalUuid,
    severity: z.preprocess(emptyToUndefined, z.enum(E.exception_severity).optional()),
  }),
  z.object({ op: z.literal("escalate"), note: reason("Say why it needs the operations manager", 2000) }),
  z.object({ op: z.literal("resolve"), resolution: reason("Describe how it was resolved", 1000) }),
]);
