import { z } from "zod";

/** Form helpers: empty strings from HTML inputs become undefined. */
export const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

export const optionalText = (max = 200) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

export const requiredText = (label: string, max = 200) =>
  z.string({ error: `Enter ${label}` }).trim().min(1, { error: `Enter ${label}` }).max(max);

/** International phone number. Spaces, dashes and brackets are removed (e.g. "+250 788 123 456"). */
export const phoneE164 = z
  .string()
  .transform((v) => v.replace(/[\s\-().]/g, ""))
  .pipe(z.string().regex(/^\+[1-9]\d{6,14}$/, { error: "Use international format, e.g. +250788123456" }));

export const optionalPhone = z.preprocess(emptyToUndefined, phoneE164.optional());

/** Email: trimmed and lower-cased BEFORE validation (phone keyboards often add a trailing space). */
export const emailField = z
  .string({ error: "Enter a valid email address" })
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: "Enter a valid email address" }));

export const optionalEmail = z.preprocess(emptyToUndefined, emailField.optional());

export const uuid = (label: string) => z.uuid({ error: `Choose ${label}` });
export const optionalUuid = z.preprocess(emptyToUndefined, z.uuid().optional());

export const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

export const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "rw", label: "Kinyarwanda" },
  { value: "sw", label: "Kiswahili" },
] as const;

export const TIMEZONES = [
  "Africa/Kigali",
  "Africa/Bujumbura",
  "Africa/Dar_es_Salaam",
  "Africa/Nairobi",
  "Africa/Kampala",
  "Africa/Lubumbashi",
  "Africa/Kinshasa",
  "Africa/Juba",
] as const;

/** Destination countries served (ISO 3166-1 alpha-2). */
export const COUNTRIES = [
  { value: "RW", label: "Rwanda" },
  { value: "BI", label: "Burundi" },
  { value: "CD", label: "DR Congo" },
  { value: "UG", label: "Uganda" },
  { value: "TZ", label: "Tanzania" },
  { value: "KE", label: "Kenya" },
  { value: "SS", label: "South Sudan" },
] as const;

/** Turns a ZodError into { field: [messages] } for the forms. */
export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export type ActionState<Values = Record<string, unknown>> =
  | {
      ok?: boolean;
      error?: string;
      message?: string;
      fieldErrors?: Record<string, string[]>;
      values?: Values;
    }
  | undefined;
