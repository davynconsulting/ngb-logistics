"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/dal/session";
import { createClient } from "@/lib/supabase/server";

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
