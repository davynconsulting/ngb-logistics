"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/dal/session";
import { createClient } from "@/lib/supabase/server";
import { RETRY_WINDOWS } from "@/lib/domain/notifications";

/*
 * Retry a failed notification delivery (operations manager/admin). The
 * database function checks the role and that the delivery is failed, resets
 * it to pending, and the sender picks it up within a minute.
 */
export async function retryDelivery(deliveryId: string): Promise<void> {
  await requireStaff("admin", "ops_manager");
  const id = z.uuid().safeParse(deliveryId);
  if (!id.success) redirect("/admin/notifications?retry=failed");
  const supabase = await createClient();
  const { error } = await supabase.rpc("retry_notification_delivery", { p_delivery_id: id.data });
  redirect(`/admin/notifications?retry=${error ? "failed" : "ok"}`);
}

/** After a provider outage: retries, in one step, every failed delivery from the chosen period (at most 500 per click). */
const BULK = z.object({
  hours: z.coerce.number().int().refine((h) => RETRY_WINDOWS.some((w) => w.hours === h)),
  channel: z.enum(["all", "push", "whatsapp"]),
});

export async function retryFailedSince(formData: FormData): Promise<void> {
  await requireStaff("admin", "ops_manager");
  const v = BULK.safeParse({ hours: formData.get("hours"), channel: formData.get("channel") });
  if (!v.success) redirect("/admin/notifications?bulk=failed");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("retry_failed_deliveries", {
    p_since: new Date(Date.now() - v.data.hours * 3600e3).toISOString(),
    p_channel: v.data.channel === "all" ? undefined : v.data.channel,
  });
  redirect(error ? "/admin/notifications?bulk=failed" : `/admin/notifications?bulk=${data ?? 0}`);
}

/**
 * Pause or resume outbound sending during a provider incident (admin only: the
 * app_settings RLS policy allows only admins, and the change is audited).
 * Deliveries keep queuing while paused; nothing is lost.
 */
export async function setSenderPaused(paused: boolean): Promise<void> {
  const user = await requireStaff("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.from("app_settings")
    .update({ value: paused === true, updated_at: new Date().toISOString(), updated_by: user.id })
    .eq("key", "notify.sender_paused").select("key");
  redirect(`/admin/notifications?pause=${error || !data?.length ? "failed" : paused === true ? "on" : "off"}`);
}
