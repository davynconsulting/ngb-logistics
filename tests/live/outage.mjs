// Outage drill against the dev project (Sprint 5 Task 4, AC-18).
// Scenario: the WhatsApp provider is down for longer than a day.
//   1. sending paused by an admin from the screen (audited); milestones keep being recorded
//   2. messages wait, the client's in-app inbox fills normally, the screen says "paused"
//   3. after 24 h undelivered they end as failed ("expired"); nothing about the shipment changes
//   4. the provider is back: an ops manager retries the whole outage in one step
//      (a doc officer cannot; an ops manager cannot touch the pause switch), and they go out
// Uses the real sender code in this process with the mock WhatsApp provider (as notifications.mjs).
// The 24 hours are simulated by moving this run's own deliveries' queue time back (service role).
import { action, check, cn, finish, formAction, get, login, pageText, svc } from "./_shared.mjs";
import { runSender, senderFromEnv } from "../../supabase/functions/_shared/notify/sender.ts";
import { mockWhatsApp } from "../../supabase/functions/_shared/notify/whatsapp.ts";

console.log("Outage drill (AC-18):");
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const admin = await login("admin@ngb.example");
const ops = await login("ops.manager@ngb.example");
const doc = await login("doc.officer@ngb.example");
const aline = await login("aline@akagera.example");
const { data: alineP } = await svc.from("profiles").select("id").eq("email", "aline@akagera.example").single();

const outbox = [];
let waMode = "transient";
const provider = { name: "mock", send: (m) => mockWhatsApp({ mode: waMode, outbox }).send(m) };
const cfg = senderFromEnv((k) => process.env[k], { whatsapp: provider });
const send = () => runSender(cfg, { limit: 100, maxBatches: 20, budgetMs: 60_000, ignorePause: true });
const unpause = () => svc.from("app_settings").update({ value: false }).eq("key", "notify.sender_paused");

const stamp = Date.now().toString().slice(-6);
const phone = `+250000${stamp}`;   // +250 000 … cannot reach a real subscriber (same rule as the seed data)
try {
  await aline.api.from("notification_preferences").update({ whatsapp_opt_in: true, whatsapp_phone: phone, consent_source: "portal" }).eq("user_id", alineP.id);

  // ---- 1. an admin pauses sending from the screen ----
  const denied = await action(ops, "setSenderPaused", [true], "/admin/notifications");
  check("an ops manager cannot use the pause switch", !/pause=on/.test(denied.redirect ?? ""), JSON.stringify(denied));
  const p = await action(admin, "setSenderPaused", [true], "/admin/notifications");
  check("an admin pauses sending", /pause=on/.test(p.redirect ?? ""), JSON.stringify(p));
  const { data: audit } = await svc.from("audit_log").select("actor_id, new_data").eq("table_name", "app_settings")
    .gte("occurred_at", ago(0.05)).order("id", { ascending: false }).limit(1);
  const { data: adminP } = await svc.from("profiles").select("id").eq("email", "admin@ngb.example").single();
  check("…and the change is in the audit log with who made it", audit?.[0]?.actor_id === adminP.id && audit[0].new_data?.key === "notify.sender_paused", JSON.stringify(audit));

  // ---- 2. milestones during the outage ----
  const { data: akagera } = await svc.from("organizations").select("id").eq("client_code", "AKAGERA").single();
  const { data: dar } = await svc.from("ports").select("id").eq("code", "TZDAR").single();
  const reg = await doc.api.rpc("register_shipment", {
    p_shipment: { client_id: akagera.id, bl_number: `TESTBLOUT${stamp}`, origin_port_id: dar.id, destination_country: "RW",
      destination_city: "Kigali", cargo_description: "Outage drill cargo (fictional)" },
    p_containers: [{ container_number: cn(700000 + (+stamp % 100000)), size_type: "40HC" }] });
  if (reg.error) throw new Error("fixture: " + reg.error.message);
  const shipId = reg.data[0].shipment_id;
  const { data: ship } = await svc.from("shipments").select("shipment_reference, containers(id)").eq("id", shipId).single();
  console.log(`fixture: ${ship.shipment_reference}`);
  const steps = [
    ["shipment_confirmed", {}], ["vessel_arrived", { p_location: "Dar es Salaam" }],
    ["container_discharged", { p_location: "TICTS", p_container_ids: [ship.containers[0].id] }],
  ];
  let recorded = 0;
  for (const [i, [m, extra]] of steps.entries()) {
    const r = await ops.api.rpc("record_milestone", { p_shipment_id: shipId, p_milestone: m, p_event_at: ago(3 - i), ...extra });
    if (!r.error) recorded++; else console.log("   ", m, r.error.message);
  }
  check("3 milestones recorded while sending is paused", recorded === 3);
  const mine = async () => (await svc.from("notification_deliveries")
    .select("id, state, error_code, attempt_count, notifications!inner(shipment_id, recipient_id, template_key)")
    .eq("notifications.shipment_id", shipId).eq("notifications.recipient_id", alineP.id).eq("channel", "whatsapp")).data ?? [];
  let wa = await mine();
  check("WhatsApp messages wait in the queue (not lost, not sent)", wa.length === 3 && wa.every((d) => d.state === "pending" && d.attempt_count === 0), JSON.stringify(wa.map((d) => d.state)));
  const inbox = await aline.api.from("notifications").select("template_key").eq("shipment_id", shipId);
  check("client's in-app inbox has all 3 updates during the outage", inbox.data?.length === 3, JSON.stringify(inbox.error ?? inbox.data?.length));

  const health = await ops.api.rpc("notification_health");
  check("health: paused, messages waiting", health.data?.[0]?.sender_paused === true && health.data[0].pending_count >= 3, JSON.stringify(health.error ?? health.data));
  const html = await pageText(await get("/admin/notifications", ops));
  check("screen tells the ops manager sending is paused and milestones are not affected",
    html.includes("Sending is paused") && html.includes("Milestones and in-app notifications are not affected"));
  check("…and that only an admin can resume", html.includes("An admin can resume sending"));
  check("health is refused to a client", !!(await aline.api.rpc("notification_health")).error);

  // ---- 3. more than 24 h without delivery ----
  await svc.from("notification_deliveries").update({ created_at: ago(25) }).in("id", wa.map((d) => d.id));
  await send();   // the provider is still down; the sender expires what is too old
  wa = await mine();
  check("after 24 h undelivered → failed as expired", wa.every((d) => d.state === "failed" && d.error_code === "expired"), JSON.stringify(wa.map((d) => `${d.state}/${d.error_code}`)));
  const { data: events } = await svc.from("milestone_events").select("milestone_type").eq("shipment_id", shipId);
  const { data: shipNow } = await svc.from("shipments").select("overall_status").eq("id", shipId).single();
  check("the shipment's milestones and status are untouched by the failed messages", events?.length === 3 && shipNow.overall_status === "container_discharged",
    JSON.stringify({ n: events?.length, s: shipNow?.overall_status }));
  const page2 = await pageText(await get("/admin/notifications", ops));
  check("failed messages listed with the bulk retry form", page2.includes(ship.shipment_reference) && page2.includes("Retry failed messages queued in the"));

  // ---- 4. provider back: one-step retry ----
  const noDoc = await formAction(doc, "retryFailedSince", [], { hours: "72", channel: "whatsapp" }, "/admin/notifications");
  check("a doc officer cannot bulk-retry", !/bulk=\d+/.test(noDoc.redirect ?? ""), JSON.stringify(noDoc));
  wa = await mine();
  check("…and nothing changed", wa.every((d) => d.state === "failed"));
  const bad = await formAction(ops, "retryFailedSince", [], { hours: "5", channel: "whatsapp" }, "/admin/notifications");
  check("a period that is not offered is refused", /bulk=failed/.test(bad.redirect ?? ""), JSON.stringify(bad));
  const bulk = await formAction(ops, "retryFailedSince", [], { hours: "72", channel: "whatsapp" }, "/admin/notifications");
  const n = Number((bulk.redirect ?? "").match(/bulk=(\d+)/)?.[1] ?? -1);
  check(`ops manager retries the outage in one step (${n} queued again)`, n >= 3, JSON.stringify(bulk));
  wa = await mine();
  check("this run's messages are waiting again, attempts reset", wa.every((d) => d.state === "pending" && d.attempt_count === 0));
  const { data: bulkAudit } = await svc.from("audit_log").select("new_data").eq("record_id", "bulk-retry").gte("occurred_at", ago(0.05));
  check("bulk retry is in the audit log", bulkAudit?.some((a) => a.new_data?.retried === n && a.new_data?.channel === "whatsapp"), JSON.stringify(bulkAudit));
  waMode = "ok";
  await send();
  wa = await mine();
  check("provider back → all delivered", wa.length === 3 && wa.every((d) => d.state === "sent"), JSON.stringify(wa.map((d) => d.state)));
  check("the client got each update once, in the right order",
    JSON.stringify(outbox.filter((m) => m.to === phone).map((m) => m.template)) ===
    JSON.stringify(["ngb_milestone_shipment_confirmed", "ngb_milestone_vessel_arrived", "ngb_milestone_container_discharged"]),
    JSON.stringify(outbox.filter((m) => m.to === phone).map((m) => m.template)));
  const again = await formAction(ops, "retryFailedSince", [], { hours: "72", channel: "whatsapp" }, "/admin/notifications");
  check("retrying again sends nothing twice (only failed ones are retried)", !(await mine()).some((d) => d.state !== "sent") && /bulk=\d+/.test(again.redirect ?? ""));

  const r = await action(admin, "setSenderPaused", [false], "/admin/notifications");
  check("an admin resumes sending from the screen", /pause=off/.test(r.redirect ?? ""), JSON.stringify(r));
} finally {
  const un = await unpause();
  check("sending is not left paused", !un.error, un.error?.message);
  await svc.from("notification_preferences").update({ whatsapp_opt_in: false, whatsapp_phone: null }).eq("user_id", alineP.id);
}

finish();
