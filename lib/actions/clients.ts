"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireStaff } from "@/lib/dal/session";
import { createClient } from "@/lib/supabase/server";
import { clientSchema } from "@/lib/validation/client";
import { fieldErrors, type ActionState } from "@/lib/validation/common";

const FIELDS = [
  "client_code", "legal_name", "primary_contact_name", "phone_e164", "email", "billing_address", "tax_id",
  "preferred_language", "timezone", "billing_terms_days", "credit_limit", "credit_currency",
  "account_manager_id", "show_driver_contact", "is_active",
] as const;

/**
 * Create (id = null) or update a client organization.
 * Allowed: admin, operations manager (also enforced by RLS).
 */
export async function saveClient(id: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff("admin", "ops_manager");

  const raw = Object.fromEntries(FIELDS.map((f) => [f, formData.get(f) ?? undefined]));
  const values = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === "string" ? v : ""]));
  const parsed = clientSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  const v = parsed.data;
  const row = {
    legal_name: v.legal_name,
    primary_contact_name: v.primary_contact_name,
    phone_e164: v.phone_e164,
    email: v.email ?? null,
    billing_address: v.billing_address ?? null,
    tax_id: v.tax_id ?? null,
    preferred_language: v.preferred_language,
    timezone: v.timezone,
    billing_terms_days: v.billing_terms_days ?? null,
    // numeric(14,2): send the validated decimal *string* so no float conversion ever happens.
    // (Generated types say `number` for numeric; PostgREST accepts the exact string.)
    credit_limit: (v.credit_limit ?? null) as unknown as number | null,
    credit_currency: v.credit_currency ?? null,
    account_manager_id: v.account_manager_id ?? null,
    show_driver_contact: v.show_driver_contact,
  };

  const supabase = await createClient();
  if (id === null) {
    const { data, error } = await supabase
      .from("organizations")
      .insert({ ...row, client_code: v.client_code })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") {
        return { fieldErrors: { client_code: ["This client code is already used"] }, values };
      }
      return { error: "Could not save the client. Please try again.", values };
    }
    redirect(`/admin/clients/${data.id}?created=1`);
  }

  const { error, count } = await supabase
    .from("organizations")
    .update({ ...row, is_active: v.is_active ?? true }, { count: "exact" })
    .eq("id", id)
    .eq("is_internal", false);
  if (error || count === 0) return { error: "Could not save the client. Please try again.", values };
  refresh();
  return { ok: true, message: "Client details saved." };
}
