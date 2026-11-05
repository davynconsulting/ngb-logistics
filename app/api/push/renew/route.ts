import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/dal/session";
import { createClient } from "@/lib/supabase/server";
import { endpointSchema, pushSubscriptionSchema } from "@/lib/validation/push";

/*
 * Called by the service worker when the browser rotates a push subscription
 * (pushsubscriptionchange). Same-origin only, with the user's session cookie;
 * the old endpoint is removed only if it belonged to this user (RLS).
 */
const bodySchema = z.object({ oldEndpoint: endpointSchema.nullable().optional(), subscription: pushSubscriptionSchema });

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin || origin !== req.nextUrl.origin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!req.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "unsupported" }, { status: 415 });

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let json: unknown;
  try { json = await req.json(); } catch { return NextResponse.json({ error: "invalid" }, { status: 400 }); }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const supabase = await createClient();
  const { subscription, oldEndpoint } = parsed.data;
  if (oldEndpoint && oldEndpoint !== subscription.endpoint) {
    await supabase.from("push_subscriptions").delete().eq("endpoint", oldEndpoint);
  }
  const { error } = await supabase.rpc("register_push_subscription", {
    p_endpoint: subscription.endpoint, p_p256dh: subscription.keys.p256dh, p_auth: subscription.keys.auth,
    p_user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? undefined,
  });
  if (error) return NextResponse.json({ error: "failed" }, { status: 500 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
