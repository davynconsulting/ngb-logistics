import { describe, expect, it } from "vitest";
import { b64urlEncode } from "@/supabase/functions/_shared/notify/bytes.ts";
import { runSender, type ClaimedDelivery, type SenderConfig } from "@/supabase/functions/_shared/notify/sender.ts";
import { mockWhatsApp, whatsappFromEnv, type WhatsAppMessage } from "@/supabase/functions/_shared/notify/whatsapp.ts";

const subtle = globalThis.crypto.subtle;

async function vapid() {
  const kp = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]) as CryptoKeyPair;
  return { publicKey: b64urlEncode(await subtle.exportKey("raw", kp.publicKey)), privateKey: (await subtle.exportKey("jwk", kp.privateKey)).d!, subject: "mailto:ops@ngb.example" };
}
async function subscription(endpoint: string) {
  const kp = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  return { endpoint, p256dh: b64urlEncode(await subtle.exportKey("raw", kp.publicKey)), auth: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))) };
}

const base = (over: Partial<ClaimedDelivery>): ClaimedDelivery => ({
  delivery_id: crypto.randomUUID(), channel: "push", attempt_count: 1, notification_id: crypto.randomUUID(),
  recipient_id: crypto.randomUUID(), template_key: "milestone.arrived",
  payload: { reference: "NGB-2026-00031", label: "Arrived at destination", containers: ["MSKU1234565"] },
  shipment_id: null, locale: "en", timezone: "Africa/Kigali", whatsapp_phone: null, subscriptions: null, ...over,
});

/** Fake database: returns the given rows once, records completions. */
function fakeDb(rows: ClaimedDelivery[]) {
  const completions: Record<string, unknown>[] = [];
  let claimed = false;
  const rpc: SenderConfig["rpc"] = async (fn, args) => {
    if (fn === "claim_notification_deliveries") { if (claimed) return []; claimed = true; return rows; }
    if (fn === "complete_notification_delivery") { completions.push(args); return null; }
    throw new Error(`unexpected rpc ${fn}`);
  };
  const by = (id: string) => completions.find((c) => c.p_delivery_id === id)!;
  return { rpc, completions, by };
}

/** Fake push services: status per endpoint. */
const pushServices = (status: Record<string, number>) =>
  (async (url: string) => new Response(status[url] === 201 ? null : "x", { status: status[url] ?? 500 })) as unknown as typeof fetch;

describe("notification sender", () => {
  it("push: sends to every device, removes expired ones, marks sent (AC-06)", async () => {
    const good = await subscription("https://fcm.googleapis.com/fcm/send/good");
    const gone = await subscription("https://fcm.googleapis.com/fcm/send/gone");
    const d = base({ subscriptions: [good, gone] });
    const db = fakeDb([d]);
    const sum = await runSender({ rpc: db.rpc, vapid: await vapid(), whatsapp: mockWhatsApp(), fetchImpl: pushServices({ [good.endpoint]: 201, [gone.endpoint]: 410 }) });
    expect(sum).toMatchObject({ claimed: 1, sent: 1 });
    expect(db.by(d.delivery_id)).toMatchObject({ p_ok: true, p_dead_endpoints: [gone.endpoint] });
    expect(String(db.by(d.delivery_id).p_provider_message_id)).toMatch(/^push:1\/2/);
  });

  it("push: no device → suppressed; all expired → suppressed with clean-up", async () => {
    const gone = await subscription("https://fcm.googleapis.com/fcm/send/old");
    const none = base({ subscriptions: [] });
    const expired = base({ subscriptions: [gone] });
    const db = fakeDb([none, expired]);
    const sum = await runSender({ rpc: db.rpc, vapid: await vapid(), whatsapp: mockWhatsApp(), fetchImpl: pushServices({ [gone.endpoint]: 404 }) });
    expect(sum.suppressed).toBe(2);
    expect(db.by(none.delivery_id)).toMatchObject({ p_ok: false, p_suppress: true, p_error_code: "no_subscription" });
    expect(db.by(expired.delivery_id)).toMatchObject({ p_suppress: true, p_dead_endpoints: [gone.endpoint] });
  });

  it("push service outage → retried, not lost (AC-18)", async () => {
    const s = await subscription("https://fcm.googleapis.com/fcm/send/busy");
    const d = base({ subscriptions: [s] });
    const db = fakeDb([d]);
    const sum = await runSender({ rpc: db.rpc, vapid: await vapid(), whatsapp: mockWhatsApp(), fetchImpl: pushServices({ [s.endpoint]: 503 }) });
    expect(sum.retry).toBe(1);
    expect(db.by(d.delivery_id)).toMatchObject({ p_ok: false, p_permanent: false, p_suppress: false, p_error_code: "push_503" });
  });

  it("push without VAPID keys is a retryable configuration error", async () => {
    const d = base({ subscriptions: [await subscription("https://fcm.googleapis.com/fcm/send/x")] });
    const db = fakeDb([d]);
    await runSender({ rpc: db.rpc, vapid: null, whatsapp: mockWhatsApp() });
    expect(db.by(d.delivery_id)).toMatchObject({ p_ok: false, p_permanent: false, p_error_code: "push_not_configured" });
  });

  it("WhatsApp: the opted-in client gets the template through the provider (AC-07)", async () => {
    const outbox: WhatsAppMessage[] = [];
    const d = base({ channel: "whatsapp", whatsapp_phone: "+250788000001" });
    const db = fakeDb([d]);
    const sum = await runSender({ rpc: db.rpc, vapid: null, whatsapp: mockWhatsApp({ outbox }) });
    expect(sum.sent).toBe(1);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ to: "+250788000001", template: "ngb_milestone_arrived", language: "en" });
    expect(outbox[0].text).toContain("NGB-2026-00031: Arrived at destination");
    expect(String(db.by(d.delivery_id).p_provider_message_id)).toMatch(/^mock:mock-wa-/);
  });

  it("one person's messages go out in queue order, even when earlier sends are slower (outage backlog)", async () => {
    const outbox: WhatsAppMessage[] = [];
    const inner = mockWhatsApp({ outbox });
    const slow = { name: "mock", send: async (m: WhatsAppMessage) => {   // earlier messages take longer
      await new Promise((r) => setTimeout(r, m.text.includes("step 0") ? 30 : m.text.includes("step 1") ? 15 : 1));
      return inner.send(m);
    } } as ReturnType<typeof mockWhatsApp>;
    const alice = crypto.randomUUID(), bob = crypto.randomUUID();
    const row = (who: string, phone: string, i: number) => base({ channel: "whatsapp", recipient_id: who, whatsapp_phone: phone,
      payload: { reference: "NGB-2026-00031", label: `step ${i}`, containers: [] } });
    const rows = [row(alice, "+250000000001", 0), row(bob, "+250000000002", 0), row(alice, "+250000000001", 1), row(alice, "+250000000001", 2), row(bob, "+250000000002", 1)];
    const sum = await runSender({ rpc: fakeDb(rows).rpc, vapid: null, whatsapp: slow });
    expect(sum.sent).toBe(5);
    const steps = (to: string) => outbox.filter((m) => m.to === to).map((m) => m.text.match(/step (\d)/)?.[1]);
    expect(steps("+250000000001")).toEqual(["0", "1", "2"]);
    expect(steps("+250000000002")).toEqual(["0", "1"]);
  });

  it("WhatsApp outage → retried; rejection → failed; consent withdrawn → suppressed", async () => {
    const out = base({ channel: "whatsapp", whatsapp_phone: "+250788000001" });
    let db = fakeDb([out]);
    await runSender({ rpc: db.rpc, vapid: null, whatsapp: mockWhatsApp({ mode: "transient" }) });
    expect(db.by(out.delivery_id)).toMatchObject({ p_ok: false, p_permanent: false, p_error_code: "whatsapp_unavailable" });
    expect(String(db.by(out.delivery_id).p_error_detail)).toContain("+250788***001"); // number masked in logs

    const rej = base({ channel: "whatsapp", whatsapp_phone: "+250788000001" });
    db = fakeDb([rej]);
    await runSender({ rpc: db.rpc, vapid: null, whatsapp: mockWhatsApp({ mode: "permanent" }) });
    expect(db.by(rej.delivery_id)).toMatchObject({ p_permanent: true, p_error_code: "whatsapp_rejected" });

    const noConsent = base({ channel: "whatsapp", whatsapp_phone: null });
    db = fakeDb([noConsent]);
    await runSender({ rpc: db.rpc, vapid: null, whatsapp: mockWhatsApp() });
    expect(db.by(noConsent.delivery_id)).toMatchObject({ p_suppress: true, p_error_code: "no_consent" });
  });

  it("an unknown template fails permanently instead of retrying", async () => {
    const d = base({ template_key: "invoice.paid" });
    const db = fakeDb([d]);
    const sum = await runSender({ rpc: db.rpc, vapid: null, whatsapp: mockWhatsApp() });
    expect(sum.failed).toBe(1);
    expect(db.by(d.delivery_id)).toMatchObject({ p_permanent: true, p_error_code: "unknown_template" });
  });

  it("a failure to record one outcome does not stop the others", async () => {
    const a = base({ subscriptions: [] }), b = base({ subscriptions: [] });
    const db = fakeDb([a, b]);
    const rpc: SenderConfig["rpc"] = async (fn, args) => {
      if (fn === "complete_notification_delivery" && args.p_delivery_id === a.delivery_id) throw new Error("network");
      return db.rpc(fn, args);
    };
    const sum = await runSender({ rpc, vapid: null, whatsapp: mockWhatsApp() });
    expect(sum).toMatchObject({ errors: 1, suppressed: 1 });
  });

  it("only the mock WhatsApp provider can be configured in Phase 1", () => {
    expect(whatsappFromEnv(() => undefined).name).toBe("mock");
    expect(() => whatsappFromEnv((k) => (k === "WHATSAPP_PROVIDER" ? "twilio" : undefined))).toThrow(/not available/);
    expect(() => whatsappFromEnv((k) => (k === "WHATSAPP_MOCK_MODE" ? "boom" : undefined))).toThrow();
  });
});
