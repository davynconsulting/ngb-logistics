import "server-only";
import { createClient } from "@/lib/supabase/server";

/** User accounts as visible to staff (RLS: staff can read all profiles). */
export async function listUsers({ organizationId }: { organizationId?: string } = {}) {
  const supabase = await createClient();
  let query = supabase
    .from("profiles")
    .select(
      "id, email, full_name, role, is_active, last_login_at, created_at, organization:organizations!profiles_organization_id_fkey(id, legal_name, client_code, is_internal)",
    )
    .order("is_active", { ascending: false })
    .order("full_name");
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data, error } = await query;
  if (error) throw new Error("Could not load users");
  return data;
}

export type UserRow = Awaited<ReturnType<typeof listUsers>>[number];
