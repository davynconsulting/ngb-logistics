/*
 * Notification sender: claims due deliveries from the database outbox, sends
 * them (Web Push / WhatsApp), and records each outcome. The database decides
 * retries (backoff 1/5/15/60 min, failed after 5 attempts or 24 h) and
 * deduplication; this code only classifies results.
 *
 * At-least-once: if recording an outcome fails, the row is reclaimed after
 * its 5-minute lock and sent again. Push `tag` / WhatsApp provider idempotency
 * limit the impact.
 *
 * Runtime-agnostic (Deno edge function, Node runner, Vitest).
 */
import { renderNotification, UnknownTemplateError } from "./templates.ts";
import { sendPush, type PushResult, type VapidKeys } from "./webpush.ts";
import { maskPhone, whatsappFromEnv, type WhatsAppMessage, type WhatsAppProvider } from "./whatsapp.ts";

export type ClaimedDelivery = {
  delivery_id: string;
  channel: "push" | "whatsapp";
  attempt_count: number;
  notification_id: string;
  recipient_id: string;
  template_key: string;
  payload: Record<string, unknown>;
  shipment_id: string | null;
  locale: string;
  timezone: string;
  whatsapp_phone: string | null;
  subscriptions: { endpoint: string; p256dh: string; auth: string }[] | null;
};

export type Completion = {
  ok: boolean;
  providerMessageId?: string | null;
  code?: string | null;
  detail?: string | null;
  permanent?: boolean;
  suppress?: boolean;
  deadEndpoints?: string[];
};

export type RpcFn = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

export type SenderConfig = {
  rpc: RpcFn;
  vapid: VapidKeys | null;
  whatsapp: WhatsAppProvider;
  fetchImpl?: typeof fetch;
  extraPushHosts?: string[];
  concurrency?: number;
  log?: (event: string, data: Record<string, unknown>) => void;
};

export type RunSummary = { batches: number; claimed: number; sent: number; suppressed: number; retry: number; failed: number; errors: number };

/** Minimal PostgREST RPC client (service role). Works with legacy JWT and new `sb_secret_` keys. */
export function postgrestRpc(supabaseUrl: string, key: string, fetchImpl: typeof fetch = fetch): RpcFn {
  const base = supabaseUrl.replace(/\/+$/, "");
  return async (fn, args) => {
    const headers: Record<string, string> = { "Content-Type": "application/json", apikey: key };
    if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
    const res = await fetchImpl(`${base}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args) });
    const text = await res.text();
    if (!res.ok) throw new Error(`RPC ${fn} failed (${res.status}): ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };
}

async function deliverPush(cfg: SenderConfig, d: ClaimedDelivery, message: ReturnType<typeof renderNotification>): Promise<Completion> {
  const subs = d.subscriptions ?? [];
  if (subs.length === 0) return { ok: false, suppress: true, code: "no_subscription", detail: "No device registered for push" };
  if (!cfg.vapid) return { ok: false, code: "push_not_configured", detail: "VAPID keys are not configured" };

  const payload = JSON.stringify({
    title: message.title, body: message.body, url: message.url, tag: message.tag, id: d.notification_id,
  });
  const results: PushResult[] = await Promise.all(subs.map((s) => sendPush(s, payload, cfg.vapid!, {
    fetchImpl: cfg.fetchImpl, extraHosts: cfg.extraPushHosts, topic: message.tag,
    urgency: d.template_key.startsWith("staff.") || d.template_key === "shipment.alert" ? "high" : "normal",
  })));
  const dead = subs.filter((_, i) => { const r = results[i]; return !r.ok && r.gone; }).map((s) => s.endpoint);
  const okOnes = results.filter((r): r is Extract<PushResult, { ok: true }> => r.ok);
  const failures = results.filter((r): r is Extract<PushResult, { ok: false }> => !r.ok);
  const deadEndpoints = dead.length ? dead : undefined;

  if (okOnes.length) {
    return { ok: true, providerMessageId: `push:${okOnes.length}/${subs.length}${okOnes[0].messageId ? ` ${okOnes[0].messageId}` : ""}`.slice(0, 200), deadEndpoints };
  }
  const first = failures.find((f) => f.transient) ?? failures[0];
  if (failures.every((f) => f.gone)) {
    return { ok: false, suppress: true, code: first.code, detail: "All registered devices have expired", deadEndpoints };
  }
  return { ok: false, permanent: !failures.some((f) => f.transient), code: first.code, detail: first.detail, deadEndpoints };
}

async function deliverWhatsApp(cfg: SenderConfig, d: ClaimedDelivery, message: ReturnType<typeof renderNotification>): Promise<Completion> {
  if (!d.whatsapp_phone) return { ok: false, suppress: true, code: "no_consent", detail: "WhatsApp opt-in withdrawn or no number" };
  const m: WhatsAppMessage = {
    to: d.whatsapp_phone, template: message.whatsapp.template, language: d.locale || "en",
    params: message.whatsapp.params, text: message.whatsapp.text,
  };
  let r;
  try { r = await cfg.whatsapp.send(m); }
  catch (e) { return { ok: false, code: "whatsapp_error", detail: String((e as Error).message).slice(0, 300) }; }
  if (r.ok) return { ok: true, providerMessageId: `${cfg.whatsapp.name}:${r.messageId}` };
  return { ok: false, permanent: !r.transient, code: r.code, detail: `${r.detail} (to ${maskPhone(d.whatsapp_phone)})` };
}

export async function deliver(cfg: SenderConfig, d: ClaimedDelivery): Promise<Completion> {
  let message;
  try {
    message = renderNotification({ template_key: d.template_key, payload: d.payload, shipment_id: d.shipment_id, locale: d.locale, timezone: d.timezone });
  } catch (e) {
    const unknown = e instanceof UnknownTemplateError;
    return { ok: false, permanent: true, code: unknown ? "unknown_template" : "render_error", detail: String((e as Error).message).slice(0, 300) };
  }
  return d.channel === "push" ? deliverPush(cfg, d, message) : deliverWhatsApp(cfg, d, message);
}

async function complete(cfg: SenderConfig, d: ClaimedDelivery, c: Completion) {
  await cfg.rpc("complete_notification_delivery", {
    p_delivery_id: d.delivery_id,
    p_ok: c.ok,
    p_provider_message_id: c.providerMessageId ?? null,
    p_error_code: c.code ?? null,
    p_error_detail: c.detail ?? null,
    p_permanent: c.permanent ?? false,
    p_suppress: c.suppress ?? false,
    p_dead_endpoints: c.deadEndpoints ?? null,
  });
}

/** Process due deliveries in batches until none are left, or the time budget runs out. */
export async function runSender(cfg: SenderConfig, opts: { limit?: number; maxBatches?: number; budgetMs?: number; ignorePause?: boolean } = {}): Promise<RunSummary> {
  const limit = opts.limit ?? 50, maxBatches = opts.maxBatches ?? 5, budget = opts.budgetMs ?? 40_000;
  const started = Date.now();
  const sum: RunSummary = { batches: 0, claimed: 0, sent: 0, suppressed: 0, retry: 0, failed: 0, errors: 0 };
  const log = cfg.log ?? (() => {});

  while (sum.batches < maxBatches && Date.now() - started < budget) {
    const rows = (await cfg.rpc("claim_notification_deliveries", opts.ignorePause ? { p_limit: limit, p_ignore_pause: true } : { p_limit: limit })) as ClaimedDelivery[] | null;
    sum.batches++;
    if (!rows?.length) break;
    sum.claimed += rows.length;

    // One person's messages on one channel go out one after another, in queue order (the claim
    // returns rows oldest first), so a backlog never overtakes itself; different people in parallel.
    const groups = new Map<string, ClaimedDelivery[]>();
    for (const r of rows) {
      const k = `${r.recipient_id}|${r.channel}`;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    const queue = [...groups.values()];
    const worker = async () => {
      for (let g = queue.shift(); g; g = queue.shift()) for (const d of g) {
        const c = await deliver(cfg, d);
        try {
          await complete(cfg, d, c);
          if (c.ok) sum.sent++;
          else if (c.suppress) sum.suppressed++;
          else if (c.permanent || d.attempt_count >= 5) sum.failed++;
          else sum.retry++;
          if (!c.ok) log("delivery_not_sent", { delivery: d.delivery_id, channel: d.channel, code: c.code, attempt: d.attempt_count });
        } catch (e) {
          sum.errors++;
          log("complete_failed", { delivery: d.delivery_id, error: String((e as Error).message).slice(0, 200) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(cfg.concurrency ?? 6, queue.length) }, worker));
    if (rows.length < limit) break;
  }
  return sum;
}

/** Build the sender from environment variables (edge function and local runner). */
export function senderFromEnv(get: (k: string) => string | undefined, overrides: Partial<SenderConfig> = {}): SenderConfig {
  const url = get("SUPABASE_URL") ?? get("NEXT_PUBLIC_SUPABASE_URL");
  const key = get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const pub = get("VAPID_PUBLIC_KEY") ?? get("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
  const priv = get("VAPID_PRIVATE_KEY");
  const subject = get("VAPID_SUBJECT");
  return {
    rpc: postgrestRpc(url, key),
    vapid: pub && priv && subject ? { publicKey: pub, privateKey: priv, subject } : null,
    whatsapp: whatsappFromEnv(get),
    extraPushHosts: (get("PUSH_EXTRA_HOSTS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    ...overrides,
  };
}
