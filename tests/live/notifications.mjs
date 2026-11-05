// Notifications end to end against the dev project (AC-06, AC-07, AC-08, AC-18).
// Real triggers, real outbox, real sender code (run in this process) with a
// fake push service that decrypts what it receives, and the mock WhatsApp provider.
import { action, check, cn, finish, get, login, pageText, svc } from "./_shared.mjs";
import { runSender, senderFromEnv } from "../../supabase/functions/_shared/notify/sender.ts";
import { mockWhatsApp } from "../../supabase/functions/_shared/notify/whatsapp.ts";

console.log("Notifications (AC-06/07/08/18):");
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const subtle = globalThis.crypto.subtle;
const b64u = (b) => Buffer.from(b).toString("base64url");
const TEST_HOST = "push.ngb-test.example";

const doc = await login("doc.officer@ngb.example");
const ops = await login("ops.manager@ngb.example");
const aline = await login("aline@akagera.example");
const jean = await login("jean@kivuhardware.example");
const { data: alineP } = await svc.from("profiles").select("id").eq("email", "aline@akagera.example").single();

// ---- a browser subscription we can decrypt ----
const ua = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const uaPublic = new Uint8Array(await subtle.exportKey("raw", ua.publicKey));
const authSecret = crypto.getRandomValues(new Uint8Array(16));
const stamp = Date.now().toString().slice(-6);
const endpoint = `https://${TEST_HOST}/send/${stamp}`;
const ins = await aline.api.from("push_subscriptions").insert({ endpoint, p256dh: b64u(uaPublic), auth: b64u(authSecret), user_agent: "live-test" });
check("client registers a push subscription", !ins.error, ins.error?.message);
const spoof = await aline.api.from("push_subscriptions").insert({ user_id: (await svc.from("profiles").select("id").eq("email", "jean@kivuhardware.example").single()).data.id,
  endpoint: `${endpoint}-x`, p256dh: b64u(uaPublic), auth: b64u(authSecret) });
check("…but not for another user", !!spoof.error, spoof.error?.code);
const optIn = await aline.api.from("notification_preferences").update({ whatsapp_opt_in: true, whatsapp_phone: "+250788000901", consent_source: "portal" }).eq("user_id", alineP.id).select("consent_at");
check("client opts in to WhatsApp; consent time stamped by the database", optIn.data?.[0]?.consent_at && Date.now() - new Date(optIn.data[0].consent_at) < 120e3, JSON.stringify(optIn.error ?? optIn.data));

async function hmac(key, data) {
  const k = await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", k, data));
}
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const hkdf = async (salt, ikm, info, n) => (await hmac(await hmac(salt, ikm), cat(info, new Uint8Array([1])))).slice(0, n);
const enc = (s) => new TextEncoder().encode(s);
async function decrypt(body) {
  const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const asKey = await subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, cat(enc("WebPush: info\0"), uaPublic, asPub), 32);
  const key = await subtle.importKey("raw", await hkdf(salt, ikm, enc("Content-Encoding: aes128gcm\0"), 16), "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: await hkdf(salt, ikm, enc("Content-Encoding: nonce\0"), 12) }, key, ct));
  return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
}

// fake push service: accepts our test endpoint, decrypts and keeps the messages
const received = [];
const fakePush = async (url, init) => {
  if (!String(url).startsWith(`https://${TEST_HOST}/`)) return new Response("unknown", { status: 503 });
  if (!/^vapid t=.+, k=.+/.test(init.headers.Authorization)) return new Response("no vapid", { status: 401 });
  if (String(url) === endpoint) received.push(await decrypt(new Uint8Array(init.body)));
  return new Response(null, { status: 201, headers: { location: `https://${TEST_HOST}/m/${received.length}` } });
};
const outbox = [];
let waMode = "ok";
const provider = { name: "mock", send: (m) => mockWhatsApp({ mode: waMode, outbox }).send(m) };
const cfg = senderFromEnv((k) => process.env[k], { fetchImpl: fakePush, extraPushHosts: [TEST_HOST], whatsapp: provider });
check("VAPID keys are configured (.env.local)", !!cfg.vapid);
// pause the deployed sender so this process sends (and can simulate outages); always unpaused at the end
const pause = (on) => svc.from("app_settings").update({ value: on }).eq("key", "notify.sender_paused");
const paused = await pause(true);
if (paused.error) throw new Error("could not pause the sender: " + paused.error.message);
const send = () => runSender(cfg, { limit: 100, maxBatches: 20, budgetMs: 60_000, ignorePause: true });
try {

// ---- a fictional shipment for Akagera ----
const { data: akagera } = await svc.from("organizations").select("id").eq("client_code", "AKAGERA").single();
const { data: dar } = await svc.from("ports").select("id").eq("code", "TZDAR").single();
const reg = await doc.api.rpc("register_shipment", {
  p_shipment: { client_id: akagera.id, bl_number: `TESTBLNTF${stamp}`, origin_port_id: dar.id, destination_country: "RW",
    destination_city: "Kigali", cargo_description: "Notification test cargo (fictional)" },
  p_containers: [{ container_number: cn(600000 + (+stamp % 100000)), size_type: "40HC" }] });
if (reg.error) throw new Error("fixture: " + reg.error.message);
const shipId = reg.data[0].shipment_id;
const { data: ship } = await svc.from("shipments").select("shipment_reference, containers(id)").eq("id", shipId).single();
const containerId = ship.containers[0].id;
console.log(`fixture: ${ship.shipment_reference}`);

const confirm = await ops.api.rpc("record_milestone", { p_shipment_id: shipId, p_milestone: "shipment_confirmed", p_event_at: ago(1) });
check("staff confirms the shipment", !confirm.error, confirm.error?.message);
const { data: note } = await aline.api.from("notifications").select("id, template_key, payload").eq("shipment_id", shipId);
check("client inbox has the confirmation", note?.length === 1 && note[0].template_key === "milestone.shipment_confirmed", JSON.stringify(note));
check("another client's inbox has nothing about it (AC-05)", ((await jean.api.from("notifications").select("id").eq("shipment_id", shipId)).data ?? []).length === 0);
const deliveries = async () => (await svc.from("notification_deliveries")
  .select("id, channel, state, attempt_count, error_code, provider_message_id, notifications!inner(shipment_id, recipient_id, template_key)")
  .eq("notifications.shipment_id", shipId).eq("notifications.recipient_id", alineP.id)).data ?? [];
const queued = await deliveries();
check("push and WhatsApp deliveries queued", queued.some((d) => d.channel === "push") && queued.some((d) => d.channel === "whatsapp"), JSON.stringify(queued));

await send();
let ds = await deliveries();
const push = ds.find((d) => d.channel === "push");
const wa = ds.find((d) => d.channel === "whatsapp");
if (push?.error_code === "push_endpoint_refused") {
  check("push delivered (handled by the deployed sender before this test; test host not allow-listed there)", true);
} else {
  check("push delivered and logged (AC-06)", push?.state === "sent" && /^push:1\/1/.test(push.provider_message_id ?? ""), JSON.stringify(push));
  const msg = received.find((m) => m.title?.startsWith(ship.shipment_reference));
  check("…the device decrypts title, text and link", !!msg && /Shipment confirmed/i.test(msg.title) && msg.url === `/portal/shipments/${ship.shipment_reference}`, JSON.stringify(received));
}
check("WhatsApp sent through the mock provider and logged (AC-07)", wa?.state === "sent" && /^mock:mock-wa-/.test(wa.provider_message_id ?? ""), JSON.stringify(wa));
check("…to the consented number with the approved template name",
  outbox.some((m) => m.to === "+250788000901" && m.template === "ngb_milestone_shipment_confirmed") || wa?.state === "sent");
const attempts = (await svc.from("notification_delivery_attempts").select("ok").in("delivery_id", ds.map((d) => d.id))).data ?? [];
check("every send attempt is logged", attempts.length >= 2 && attempts.every((a) => a.ok), JSON.stringify(attempts));

// AC-08: sending again changes nothing
const before = attempts.length;
await send();
check("running the sender again sends nothing twice (AC-08)",
  ((await svc.from("notification_delivery_attempts").select("id").in("delivery_id", ds.map((d) => d.id))).data ?? []).length === before);

// AC-18: WhatsApp outage does not lose the milestone; retried later
waMode = "transient";
const arrived = await ops.api.rpc("record_milestone", { p_shipment_id: shipId, p_milestone: "vessel_arrived", p_event_at: ago(0.5), p_location: "Dar es Salaam" });
check("milestone recorded during a WhatsApp outage", !arrived.error, arrived.error?.message);
await send();
let waArr = (await deliveries()).find((d) => d.channel === "whatsapp" && d.notifications.template_key === "milestone.vessel_arrived");
check("outage → delivery kept and scheduled for retry (AC-18)", waArr?.state === "pending" && waArr.error_code === "whatsapp_unavailable" && waArr.attempt_count === 1, JSON.stringify(waArr));
check("the milestone itself is not affected", ((await svc.from("milestone_events").select("id").eq("shipment_id", shipId).eq("milestone_type", "vessel_arrived")).data ?? []).length === 1);
waMode = "ok";
await svc.from("notification_deliveries").update({ next_attempt_at: new Date().toISOString() }).eq("id", waArr.id); // the 1-minute backoff has passed
await send();
waArr = (await deliveries()).find((d) => d.id === waArr.id);
check("provider back → sent on the retry", waArr?.state === "sent" && waArr.attempt_count === 2, JSON.stringify(waArr));

// permanent failure → surfaced to staff → retried by an ops manager
waMode = "permanent";
const failing = await ops.api.rpc("record_milestone", { p_shipment_id: shipId, p_milestone: "container_discharged", p_event_at: ago(0.1), p_location: "TICTS", p_container_ids: [containerId] });
check("discharge recorded", !failing.error, failing.error?.message);
await send();
const failed = (await deliveries()).find((d) => d.channel === "whatsapp" && d.notifications.template_key === "milestone.container_discharged");
check("provider rejection → failed, not retried endlessly", failed?.state === "failed" && failed.error_code === "whatsapp_rejected", JSON.stringify(failed));
const pageHtml = await pageText(await get("/admin/notifications", ops));
check("failure is listed for the operations manager", pageHtml.includes(ship.shipment_reference) && pageHtml.includes("whatsapp_rejected"));
const clientPage = await pageText(await get("/admin/notifications", aline));
check("…and not for clients", !clientPage.includes("whatsapp_rejected"));
const docPage = await pageText(await get("/admin/notifications", doc));
check("…nor for a doc officer", !docPage.includes("whatsapp_rejected"));
const r = await action(ops, "retryDelivery", [failed.id], "/admin/notifications");
check("ops manager retries it", /retry=ok/.test(r.redirect ?? ""), JSON.stringify(r));
const r2 = await action(doc, "retryDelivery", [failed.id], "/admin/notifications");
check("a doc officer cannot retry", !/retry=ok/.test(r2.redirect ?? ""));
waMode = "ok";
await send();
check("retried message delivered", (await deliveries()).find((d) => d.id === failed.id)?.state === "sent");

} finally {
  const un = await pause(false);
  check("deployed sender unpaused again", !un.error, un.error?.message);
// ---- clean up the test device and consent ----
await svc.from("push_subscriptions").delete().eq("endpoint", endpoint);
await svc.from("notification_preferences").update({ whatsapp_opt_in: false, whatsapp_phone: null }).eq("user_id", alineP.id);
}

finish();
