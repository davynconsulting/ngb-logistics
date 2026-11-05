"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/dal/session";
import { createClient } from "@/lib/supabase/server";
import { inboxEntry, normalizePhone } from "@/lib/domain/portal";
import type { ActionState } from "@/lib/validation/common";

/*
 * Inbox and notification settings for the signed-in user. RLS: a user can
 * only mark their own notifications read and change their own preferences;
 * WhatsApp consent time is stamped by the database (0014).
 */

/** Open a notification: mark it read, then go to what it is about. */
export async function openNotification(notificationId: string): Promise<void> {
  const user = await requireUser();
  const home = user.isStaff ? "/admin" : "/portal/notifications";
  const id = z.uuid().safeParse(notificationId);
  if (!id.success) redirect(home);
  const supabase = await createClient();
  const { data } = await supabase.from("notifications")
    .select("id, template_key, payload, shipment_id, read_at").eq("id", id.data).eq("recipient_id", user.id).maybeSingle();
  if (!data) redirect(home);
  if (!data.read_at) await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", data.id);
  redirect(inboxEntry(data, "Africa/Kigali").url);
}

export async function markAllRead(): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() })
    .eq("recipient_id", user.id).is("read_at", null);
  refresh();
}

/** WhatsApp opt-in/out. The form keeps typed values on a refusal (manual submit). */
export async function saveWhatsApp(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const optIn = fd.get("whatsapp_opt_in") === "on";
  const rawPhone = String(fd.get("whatsapp_phone") ?? "");
  const supabase = await createClient();

  if (!optIn) {
    const { error } = await supabase.from("notification_preferences")
      .update({ whatsapp_opt_in: false, whatsapp_phone: null }).eq("user_id", user.id);
    if (error) return { error: "Your settings could not be saved. Please try again." };
    refresh();
    return { ok: true, message: "WhatsApp messages are off." };
  }

  const phone = normalizePhone(rawPhone);
  if (!phone) {
    return { fieldErrors: { whatsapp_phone: ["Enter the number with its country code, e.g. +250 788 123 456"] } };
  }
  if (fd.get("consent") !== "on") {
    return { fieldErrors: { consent: ["Tick the box to agree to receive WhatsApp messages"] } };
  }
  const { error } = await supabase.from("notification_preferences")
    .update({ whatsapp_opt_in: true, whatsapp_phone: phone, consent_source: "portal" }).eq("user_id", user.id);
  if (error) return { error: "Your settings could not be saved. Please try again." };
  refresh();
  return { ok: true, message: "WhatsApp messages are on." };
}
