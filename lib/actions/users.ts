"use server";

import { headers } from "next/headers";
import { refresh } from "next/cache";
import { requireStaff } from "@/lib/dal/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteUserSchema } from "@/lib/validation/user";
import { fieldErrors, type ActionState } from "@/lib/validation/common";

/**
 * User management. These actions use the SERVICE-ROLE client (needed to create
 * auth users and set app_metadata), so permission checks happen here first:
 *   • admin            → may invite / deactivate any user
 *   • ops_manager      → may invite / deactivate CLIENT users only
 * Role and organization go into app_metadata, which users cannot edit; the
 * database trigger turns them into the profile and enforces consistency.
 */

type InviteState = (NonNullable<ActionState> & { inviteLink?: string; invitedEmail?: string }) | undefined;

async function siteOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || /^\d/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

export async function inviteUser(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const actor = await requireStaff("admin", "ops_manager");
  const values = {
    email: String(formData.get("email") ?? ""),
    full_name: String(formData.get("full_name") ?? ""),
    role: String(formData.get("role") ?? ""),
    organization_id: String(formData.get("organization_id") ?? ""),
    phone_e164: String(formData.get("phone_e164") ?? ""),
  };
  const parsed = inviteUserSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const v = parsed.data;

  if (actor.role !== "admin" && v.role !== "client") {
    return { fieldErrors: { role: ["Only a system administrator can invite NGB staff"] }, values };
  }

  // Resolve the organization as the ACTOR (RLS): staff → NGB, client → chosen client org
  const supabase = await createClient();
  const orgQuery = supabase.from("organizations").select("id, is_internal, is_active");
  const { data: org } =
    v.role === "client"
      ? await orgQuery.eq("id", v.organization_id!).eq("is_internal", false).maybeSingle()
      : await orgQuery.eq("is_internal", true).maybeSingle();
  if (!org || !org.is_active) {
    return { fieldErrors: { organization_id: ["Choose an active client company"] }, values };
  }

  const admin = createAdminClient();
  // generateLink creates the user and returns a one-time token WITHOUT sending
  // an email (no email service is configured yet).
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "invite",
    email: v.email,
  });
  if (linkError || !link?.user) {
    const exists = linkError?.code === "email_exists" || /already|registered/i.test(linkError?.message ?? "");
    return exists
      ? { fieldErrors: { email: ["An account with this email already exists"] }, values }
      : { error: "Could not create the invitation. Please try again.", values };
  }

  const { error: metaError } = await admin.auth.admin.updateUserById(link.user.id, {
    app_metadata: {
      role: v.role,
      organization_id: org.id,
      full_name: v.full_name,
      phone_e164: v.phone_e164 ?? null,
      invited_by: actor.id,
    },
  });
  if (metaError) {
    await admin.auth.admin.deleteUser(link.user.id); // don't leave a half-created account
    return { error: "Could not set up the account. Please try again.", values };
  }

  const inviteLink = `${await siteOrigin()}/auth/callback?token_hash=${encodeURIComponent(
    link.properties.hashed_token,
  )}&type=invite&next=/update-password`;

  refresh();
  return {
    ok: true,
    invitedEmail: v.email,
    inviteLink,
    message: `${v.full_name} has been added. Send them the one-time link below to set their password.`,
  };
}

export async function setUserActive(userId: string, active: boolean): Promise<void> {
  const actor = await requireStaff("admin", "ops_manager");
  if (userId === actor.id) return; // never lock yourself out

  const supabase = await createClient();
  const { data: target } = await supabase.from("profiles").select("id, role").eq("id", userId).maybeSingle();
  if (!target) return;
  if (actor.role !== "admin" && target.role !== "client") return;

  const admin = createAdminClient();
  // 1) database access (every RLS rule requires an active profile)
  const { error } = await admin.from("profiles").update({ is_active: active }).eq("id", userId);
  if (error) throw new Error("Could not update the user");
  // 2) block / allow sign-in and token refresh at the Auth level
  await admin.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });
  refresh();
}
