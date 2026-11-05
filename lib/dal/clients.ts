import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Client organizations and reference lists. All queries run as the user (RLS applies). */
export async function listClients() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select(
      `id, client_code, legal_name, primary_contact_name, phone_e164, email, preferred_language,
       billing_terms_days, credit_limit, credit_currency, is_active,
       shipments(count), users:profiles!profiles_organization_id_fkey(count)`,
    )
    .eq("is_internal", false)
    .order("legal_name");
  if (error) throw new Error("Could not load clients");
  return data;
}

export async function getClient(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", id)
    .eq("is_internal", false)
    .maybeSingle();
  if (error) throw new Error("Could not load client");
  return data;
}

export type ClientRow = NonNullable<Awaited<ReturnType<typeof getClient>>>;

/** Active NGB staff, for "account manager" / "responsible user" pickers. */
export async function listActiveStaff() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .neq("role", "client")
    .eq("is_active", true)
    .order("full_name");
  if (error) throw new Error("Could not load staff");
  return data;
}

export async function listClientOptions() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("id, client_code, legal_name, timezone")
    .eq("is_internal", false)
    .eq("is_active", true)
    .order("legal_name");
  if (error) throw new Error("Could not load clients");
  return data;
}

export async function listPorts() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("ports").select("id, code, name, country").eq("is_active", true).order("name");
  if (error) throw new Error("Could not load ports");
  return data;
}
