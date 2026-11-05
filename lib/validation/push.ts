import { z } from "zod";
import { isAllowedPushEndpoint } from "@/supabase/functions/_shared/notify/webpush.ts";

const b64url = (min: number, max: number) => z.string().min(min).max(max).regex(/^[A-Za-z0-9_-]+={0,2}$/);

/** A browser PushSubscription.toJSON(), as sent by the device. */
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().max(1000).refine((u) => isAllowedPushEndpoint(u), "Not a supported push service"),
  keys: z.object({ p256dh: b64url(40, 200), auth: b64url(10, 100) }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const endpointSchema = z.string().max(1000).regex(/^https:\/\//);
