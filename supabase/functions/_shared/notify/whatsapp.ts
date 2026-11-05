/*
 * WhatsApp provider adapter. Phase 1 uses the mock provider until NGB selects
 * an approved WhatsApp Business provider (FRS §13): the real adapter will send
 * the approved template named in `template` with `params`.
 */

export type WhatsAppMessage = {
  to: string;          // E.164, e.g. +250788000001
  template: string;    // provider template name, e.g. ngb_milestone_arrived
  language: string;    // e.g. en
  params: string[];    // template variables, in order
  text: string;        // the rendered text (the mock "sends" this)
};

export type WhatsAppResult =
  | { ok: true; messageId: string }
  | { ok: false; transient: boolean; code: string; detail: string };

export interface WhatsAppProvider {
  readonly name: string;
  send(m: WhatsAppMessage): Promise<WhatsAppResult>;
}

export const isE164 = (s: string) => /^\+[1-9]\d{7,14}$/.test(s);
/** +250788***001: enough to diagnose, without logging the full number. */
export const maskPhone = (s: string) => (s.length > 7 ? `${s.slice(0, 7)}***${s.slice(-3)}` : "***");

export type MockMode = "ok" | "transient" | "permanent";

/**
 * Mock provider. `mode` simulates an outage (transient) or a refusal
 * (permanent) so retries and failure surfacing can be tested (AC-07, AC-18).
 * `outbox`, when given, collects what would have been sent.
 */
export function mockWhatsApp(opts: { mode?: MockMode; outbox?: WhatsAppMessage[] } = {}): WhatsAppProvider {
  const mode = opts.mode ?? "ok";
  return {
    name: "mock",
    async send(m) {
      if (!isE164(m.to)) return { ok: false, transient: false, code: "whatsapp_invalid_number", detail: "Not an E.164 number" };
      if (mode === "transient") return { ok: false, transient: true, code: "whatsapp_unavailable", detail: "Mock provider outage (simulated)" };
      if (mode === "permanent") return { ok: false, transient: false, code: "whatsapp_rejected", detail: "Mock provider rejected the template (simulated)" };
      opts.outbox?.push(m);
      return { ok: true, messageId: `mock-wa-${crypto.randomUUID()}` };
    },
  };
}

export function whatsappFromEnv(get: (k: string) => string | undefined, outbox?: WhatsAppMessage[]): WhatsAppProvider {
  const name = (get("WHATSAPP_PROVIDER") ?? "mock").trim();
  if (name !== "mock") throw new Error(`WhatsApp provider "${name}" is not available yet (Phase 1 uses the mock)`);
  const mode = get("WHATSAPP_MOCK_MODE") ?? "ok";
  if (!["ok", "transient", "permanent"].includes(mode)) throw new Error("WHATSAPP_MOCK_MODE must be ok, transient or permanent");
  return mockWhatsApp({ mode: mode as MockMode, outbox });
}
