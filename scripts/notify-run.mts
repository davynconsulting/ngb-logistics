/*
 * Runs the notification sender once from this machine, against the dev
 * project, with the same code as the edge function.
 *   npm run notify:run            send what is due
 *   npm run notify:run -- --mock-whatsapp=transient   simulate a WhatsApp outage
 * Uses SUPABASE_SERVICE_ROLE_KEY from .env.local (server side only).
 */
import { runSender, senderFromEnv } from "../supabase/functions/_shared/notify/sender.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!url.includes("idyydcuihxkyitylkugo")) {
  console.error("Refusing to run: NEXT_PUBLIC_SUPABASE_URL is not the dev project.");
  process.exit(1);
}
const mode = process.argv.find((a) => a.startsWith("--mock-whatsapp="))?.split("=")[1];

const cfg = senderFromEnv((k) => (k === "WHATSAPP_MOCK_MODE" && mode ? mode : process.env[k]), {
  log: (event, data) => console.log(event, JSON.stringify(data)),
});
if (!cfg.vapid) console.warn("VAPID keys missing: push deliveries will be retried. Run: node scripts/gen-notify-keys.mts");
const summary = await runSender(cfg, { limit: 50, maxBatches: 10, budgetMs: 120_000 });
console.log("Done:", JSON.stringify(summary));
