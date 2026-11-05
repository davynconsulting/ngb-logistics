/*
 * Adds the notification keys to .env.local if they are missing:
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY  (public; the browser subscribes with it)
 *   VAPID_PRIVATE_KEY             (server only)
 *   VAPID_SUBJECT                 (contact for push services)
 *   NOTIFY_SENDER_SECRET          (server only; pg_cron → edge function)
 * Never overwrites existing values and prints names only, never values.
 * Usage: node scripts/gen-notify-keys.mts
 */
import { existsSync, readFileSync, appendFileSync } from "node:fs";

const FILE = ".env.local";
const b64url = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64url");

const current = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
const has = (k: string) => new RegExp(`^${k}=.+`, "m").test(current);

const add: Record<string, string> = {};
if (!has("NEXT_PUBLIC_VAPID_PUBLIC_KEY") || !has("VAPID_PRIVATE_KEY")) {
  if (has("NEXT_PUBLIC_VAPID_PUBLIC_KEY") || has("VAPID_PRIVATE_KEY")) {
    console.error("Only one of the VAPID keys is set. Remove it and run again.");
    process.exit(1);
  }
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  add.NEXT_PUBLIC_VAPID_PUBLIC_KEY = b64url(await crypto.subtle.exportKey("raw", kp.publicKey));
  add.VAPID_PRIVATE_KEY = (await crypto.subtle.exportKey("jwk", kp.privateKey)).d!;
}
if (!has("VAPID_SUBJECT")) add.VAPID_SUBJECT = "mailto:notifications@ngb.example";
if (!has("NOTIFY_SENDER_SECRET")) add.NOTIFY_SENDER_SECRET = b64url(crypto.getRandomValues(new Uint8Array(32)));

const names = Object.keys(add);
if (names.length === 0) {
  console.log("All notification keys are already in .env.local.");
} else {
  const lines = names.map((k) => `${k}=${add[k]}`).join("\n");
  appendFileSync(FILE, `${current.endsWith("\n") || !current ? "" : "\n"}\n# Notifications (Sprint 3)\n${lines}\n`);
  console.log(`Added to .env.local: ${names.join(", ")}`);
}
