import "server-only";
import { createClient } from "@/lib/supabase/server";
import { ago, healthVerdict } from "@/lib/domain/notifications";

/*
 * Notification delivery health for operations managers/admins, read AS THE
 * SIGNED-IN USER (RLS: deliveries, attempts and notifications are visible to
 * admin/ops_manager; everyone else sees only their own).
 */

const STATES = ["pending", "sending", "sent", "failed", "suppressed"] as const;
export type DeliveryState = (typeof STATES)[number];

export async function getDeliveryStats() {
  const supabase = await createClient();
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const counts = await Promise.all(STATES.map((s) =>
    supabase.from("notification_deliveries").select("id", { count: "exact", head: true }).eq("state", s).gte("created_at", since)));
  const failedTotal = await supabase.from("notification_deliveries").select("id", { count: "exact", head: true }).eq("state", "failed");
  if (counts.some((c) => c.error) || failedTotal.error) throw new Error("Could not load notification stats");
  return {
    last24h: Object.fromEntries(STATES.map((s, i) => [s, counts[i].count ?? 0])) as Record<DeliveryState, number>,
    failedTotal: failedTotal.count ?? 0,
  };
}

export async function listFailedDeliveries(limit = 100) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("notification_deliveries")
    .select(`id, channel, state, attempt_count, error_code, error_detail, created_at, last_attempt_at,
      notification:notifications(template_key, shipment_id,
        recipient:profiles(full_name, role, organization:organizations!profiles_organization_id_fkey(legal_name)),
        shipment:shipments(shipment_reference),
        rule:notification_rules(description)),
      attempts:notification_delivery_attempts(id, attempted_at, ok, error_code, error_detail)`)
    .eq("state", "failed")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("Could not load failed notifications");
  return data.map((d) => ({
    ...d,
    attempts: [...(d.attempts ?? [])].sort((a, b) => b.attempted_at.localeCompare(a.attempted_at)),
  }));
}
export type FailedDelivery = Awaited<ReturnType<typeof listFailedDeliveries>>[number];

/** Is the sender keeping up? (notification_health, 0027; admin/ops_manager only) */
export async function getNotificationHealth() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notification_health");
  if (error || !data?.[0]) throw new Error("Could not load notification health");
  return { ...data[0], verdict: healthVerdict(data[0], Date.now()), lastSentAgo: ago(data[0].last_sent_at, Date.now()) };
}
export type NotificationHealth = Awaited<ReturnType<typeof getNotificationHealth>>;
