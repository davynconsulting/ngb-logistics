"use server";

import { requireUser } from "@/lib/dal/session";
import { createClient } from "@/lib/supabase/server";
import { endpointSchema, pushSubscriptionSchema } from "@/lib/validation/push";

/*
 * Push devices for the signed-in user (clients and staff). The database
 * function moves a device that was registered to someone else (shared phone).
 * Only known browser push services are accepted (the sender calls these URLs).
 */

export type PushResult = { ok: true } | { ok: false; error: string };

export async function registerPushDevice(subscription: unknown, userAgent: unknown): Promise<PushResult> {
  await requireUser();
  const parsed = pushSubscriptionSchema.safeParse(subscription);
  if (!parsed.success) return { ok: false, error: "This browser's push service is not supported." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("register_push_subscription", {
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.keys.p256dh,
    p_auth: parsed.data.keys.auth,
    p_user_agent: typeof userAgent === "string" ? userAgent.slice(0, 300) : undefined,
  });
  return error ? { ok: false, error: "Could not turn on notifications. Please try again." } : { ok: true };
}

export async function removePushDevice(endpoint: unknown): Promise<PushResult> {
  await requireUser();
  const parsed = endpointSchema.safeParse(endpoint);
  if (!parsed.success) return { ok: true };
  const supabase = await createClient();
  // RLS: only the caller's own row can be deleted
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", parsed.data);
  return error ? { ok: false, error: "Could not turn off notifications. Please try again." } : { ok: true };
}
