/*
 * Web Push with Web Crypto only (works in Deno, Node 20+ and browsers):
 *  - payload encryption: RFC 8291 (Message Encryption for Web Push), aes128gcm (RFC 8188)
 *  - sender identification: RFC 8292 (VAPID), ES256 JWT
 * No npm `web-push` needed in the edge runtime.
 */
import { b64urlDecode, b64urlEncode, concat, utf8, type Bytes } from "./bytes.ts";

export type PushSubscriptionKeys = { endpoint: string; p256dh: string; auth: string };
export type VapidKeys = { publicKey: string; privateKey: string; subject: string };

export type PushResult =
  | { ok: true; status: number; messageId: string | null }
  | { ok: false; status: number; gone: boolean; transient: boolean; code: string; detail: string };

const subtle = globalThis.crypto.subtle;
const RECORD_SIZE = 4096;
/** Push services accept 4096 bytes of body; header (86) + tag (16) + delimiter (1) leave this much. */
export const MAX_PLAINTEXT = 3993;

/** Hosts of the browser push services. Anything else is refused (subscriptions are user input → SSRF). */
const PUSH_HOSTS: RegExp[] = [
  /^fcm\.googleapis\.com$/,                 // Chrome, Edge (Android/desktop), Opera
  /^(.+\.)?push\.services\.mozilla\.com$/,  // Firefox
  /^(.+\.)?notify\.windows\.com$/,          // legacy Edge / Windows
  /^(.+\.)?push\.apple\.com$/,              // Safari (macOS, iOS home-screen apps)
];

export function isAllowedPushEndpoint(endpoint: string, extraHosts: readonly string[] = []): boolean {
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  return PUSH_HOSTS.some((r) => r.test(u.hostname)) || extraHosts.includes(u.hostname);
}

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", k, data));
}
/** HKDF-SHA256 for outputs of at most 32 bytes (one block). */
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);
}

export class PushSubscriptionError extends Error {}

/** Encrypt one push message for a subscription (aes128gcm, single record). */
export async function encryptPayload(
  sub: Pick<PushSubscriptionKeys, "p256dh" | "auth">,
  plaintext: Uint8Array,
  opts: { salt?: Bytes; localKeys?: CryptoKeyPair } = {},
): Promise<Bytes> {
  if (plaintext.length > MAX_PLAINTEXT) throw new Error("Push payload too large");
  let uaPublic: Bytes, authSecret: Bytes;
  try { uaPublic = b64urlDecode(sub.p256dh); authSecret = b64urlDecode(sub.auth); }
  catch { throw new PushSubscriptionError("Subscription keys are not base64url"); }
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new PushSubscriptionError("Invalid p256dh key");
  if (authSecret.length !== 16) throw new PushSubscriptionError("Invalid auth secret");

  const local = opts.localKeys
    ?? await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPublic = new Uint8Array(await subtle.exportKey("raw", local.publicKey));
  let uaKey: CryptoKey;
  try { uaKey = await subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []); }
  catch { throw new PushSubscriptionError("p256dh is not a P-256 point"); }
  const ecdhSecret = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));

  // RFC 8291 §3.4
  const ikm = await hkdf(authSecret, ecdhSecret, concat(utf8("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);

  const key = await subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const record = concat(plaintext, new Uint8Array([2])); // 0x02 = last record, no padding
  const ciphertext = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, record));

  // RFC 8188 §2.1 header: salt(16) | rs(4) | idlen(1) | keyid(65 = sender public key)
  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

const vapidKeyCache = new Map<string, Promise<CryptoKey>>();
function importVapidKey(keys: VapidKeys): Promise<CryptoKey> {
  let p = vapidKeyCache.get(keys.privateKey);
  if (!p) {
    const pub = b64urlDecode(keys.publicKey);
    if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID public key must be an uncompressed P-256 point");
    const jwk: JsonWebKey = {
      kty: "EC", crv: "P-256", d: keys.privateKey,
      x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)), ext: false,
    };
    p = subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    vapidKeyCache.set(keys.privateKey, p);
  }
  return p;
}

/** `Authorization` header value for a push endpoint (RFC 8292 §3). */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const enc = (o: unknown) => b64urlEncode(utf8(JSON.stringify(o)));
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: keys.subject })}`;
  const sig = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await importVapidKey(keys), utf8(unsigned));
  return `vapid t=${unsigned}.${b64urlEncode(sig)}, k=${keys.publicKey}`;
}

export type SendPushOptions = {
  ttlSeconds?: number;
  urgency?: "very-low" | "low" | "normal" | "high";
  topic?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  extraHosts?: readonly string[];
};

/** Send one encrypted message to one subscription and classify the response. */
export async function sendPush(sub: PushSubscriptionKeys, payload: string, keys: VapidKeys, opts: SendPushOptions = {}): Promise<PushResult> {
  if (!isAllowedPushEndpoint(sub.endpoint, opts.extraHosts)) {
    return { ok: false, status: 0, gone: true, transient: false, code: "push_endpoint_refused", detail: "Not a known push service" };
  }
  let body: Bytes;
  try { body = await encryptPayload(sub, utf8(payload)); }
  catch (e) {
    const bad = e instanceof PushSubscriptionError;
    return { ok: false, status: 0, gone: bad, transient: false, code: bad ? "push_bad_subscription" : "push_payload", detail: String((e as Error).message) };
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "Content-Encoding": "aes128gcm",
    TTL: String(opts.ttlSeconds ?? 86400),
    Urgency: opts.urgency ?? "normal",
    Authorization: await vapidAuthorization(sub.endpoint, keys),
  };
  if (opts.topic) headers.Topic = opts.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);

  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(sub.endpoint, {
      method: "POST", headers, body, redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
  } catch (e) {
    return { ok: false, status: 0, gone: false, transient: true, code: "push_network", detail: String((e as Error).message).slice(0, 300) };
  }
  if (res.status >= 200 && res.status < 300) {
    return { ok: true, status: res.status, messageId: res.headers.get("location") };
  }
  const detail = (await res.text().catch(() => "")).slice(0, 300) || res.statusText;
  if (res.status === 404 || res.status === 410) return { ok: false, status: res.status, gone: true, transient: false, code: `push_${res.status}`, detail };
  if (res.status === 429 || res.status >= 500) return { ok: false, status: res.status, gone: false, transient: true, code: `push_${res.status}`, detail };
  return { ok: false, status: res.status, gone: false, transient: false, code: `push_${res.status}`, detail };
}
