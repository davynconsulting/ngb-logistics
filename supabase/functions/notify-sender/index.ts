/*
 * notify-sender: Supabase Edge Function that sends queued notifications.
 *
 * Called every minute by pg_cron (and right after new deliveries are queued)
 * via pg_net, with `Authorization: Bearer <NOTIFY_SENDER_SECRET>`. JWT
 * verification is off for this function (config.toml); the shared secret is
 * the gate. Users never call it.
 *
 * Secrets (supabase secrets set): NOTIFY_SENDER_SECRET, VAPID_PUBLIC_KEY,
 * VAPID_PRIVATE_KEY, VAPID_SUBJECT, WHATSAPP_PROVIDER (mock), WHATSAPP_MOCK_MODE.
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
 */
import { timingSafeEqual } from "../_shared/notify/bytes.ts";
import { runSender, senderFromEnv } from "../_shared/notify/sender.ts";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): unknown;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let running = false; // one run per isolate at a time; the database lock prevents double sends across isolates

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const secret = Deno.env.get("NOTIFY_SENDER_SECRET") ?? "";
  if (secret.length < 32) return json({ error: "not_configured" }, 500);
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!timingSafeEqual(token, secret)) return json({ error: "unauthorized" }, 401);

  if (running) return json({ skipped: "already_running" }, 202);
  running = true;
  try {
    const cfg = senderFromEnv((k) => Deno.env.get(k), {
      log: (event, data) => console.log(JSON.stringify({ event, ...data })),
    });
    const summary = await runSender(cfg, { limit: 50, maxBatches: 5, budgetMs: 40_000 });
    if (summary.claimed) console.log(JSON.stringify({ event: "run", ...summary }));
    return json(summary);
  } catch (e) {
    console.error(JSON.stringify({ event: "run_failed", error: String((e as Error).message).slice(0, 300) }));
    return json({ error: "run_failed" }, 500);
  } finally {
    running = false;
  }
});
