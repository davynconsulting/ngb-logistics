import { z } from "zod";
import { CURRENCIES } from "@/lib/domain/money";
import {
  checkbox, LANGUAGES, optionalEmail, optionalText, optionalUuid, phoneE164, requiredText, TIMEZONES,
} from "./common";

/** Client organization form (FRS §6.1). */
export const clientSchema = z
  .object({
    client_code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, { error: "2–20 letters, digits or dashes, e.g. AKAGERA" }),
    legal_name: requiredText("the registered company name"),
    primary_contact_name: requiredText("the main contact's name", 120),
    phone_e164: phoneE164,
    email: optionalEmail,
    billing_address: optionalText(500),
    tax_id: optionalText(50),
    preferred_language: z.enum(LANGUAGES.map((l) => l.value) as [string, ...string[]]),
    timezone: z.enum(TIMEZONES),
    billing_terms_days: z.preprocess(
      (v) => (v === "" || v == null ? undefined : Number(v)),
      z.number({ error: "Enter days as a number" }).int().min(0).max(365).optional(),
    ),
    credit_limit: z.preprocess(
      (v) => (typeof v === "string" ? v.replace(/,/g, "").trim() || undefined : v),
      z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, { error: "Enter an amount, e.g. 25000.00" }).optional(),
    ),
    credit_currency: z.preprocess((v) => (v === "" ? undefined : v), z.enum(CURRENCIES).optional()),
    account_manager_id: optionalUuid,
    show_driver_contact: checkbox,
    is_active: checkbox.optional(),
  })
  .refine((v) => !v.credit_limit || v.credit_currency, {
    error: "Choose the currency of the credit limit",
    path: ["credit_currency"],
  });

export type ClientInput = z.infer<typeof clientSchema>;
