import { describe, expect, it } from "vitest";
import { b64urlDecode, b64urlEncode, concat, timingSafeEqual, utf8 } from "@/supabase/functions/_shared/notify/bytes.ts";
import { encryptPayload, isAllowedPushEndpoint, sendPush, vapidAuthorization } from "@/supabase/functions/_shared/notify/webpush.ts";

const subtle = globalThis.crypto.subtle;

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>) {
  const k = await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", k, data));
}
async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, len: number) {
  return (await hmac(await hmac(salt, ikm), concat(info, new Uint8Array([1])))).slice(0, len);
}

/** What the browser does on receipt (RFC 8291 §3.4 from the user agent side). */
async function decrypt(body: Uint8Array, uaPrivate: CryptoKey, uaPublic: Uint8Array<ArrayBuffer>, auth: Uint8Array<ArrayBuffer>) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ct = body.slice(21 + idlen);
  const asKey = await subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: asKey }, uaPrivate, 256));
  const ikm = await hkdf(auth, ecdh, concat(utf8("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);
  const key = await subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ct));
  expect(plain[plain.length - 1]).toBe(2); // last-record delimiter
  return { rs, text: new TextDecoder().decode(plain.slice(0, -1)) };
}

async function browserSubscription() {
  const ua = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const uaPublic = new Uint8Array(await subtle.exportKey("raw", ua.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { ua, uaPublic, auth, keys: { p256dh: b64urlEncode(uaPublic), auth: b64urlEncode(auth) } };
}

async function vapidKeys() {
  const kp = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const jwk = await subtle.exportKey("jwk", kp.privateKey);
  const pub = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
  return { kp, keys: { publicKey: b64urlEncode(pub), privateKey: jwk.d!, subject: "mailto:ops@ngb.example" } };
}

const jwkFor = (priv: string, pub: Uint8Array) => ({
  kty: "EC", crv: "P-256", d: priv, x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)),
});

describe("Web Push encryption (RFC 8291)", () => {
  it("matches the RFC 8291 Appendix A test vector", async () => {
    const asPub = b64urlDecode("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
    const asPriv = await subtle.importKey("jwk", jwkFor("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", asPub),
      { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const asPublicKey = await subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, true, []);
    const body = await encryptPayload(
      { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" },
      utf8("When I grow up, I want to be a watermelon"),
      { salt: b64urlDecode("DGv6ra1nlYgDCS1FRnbzlw"), localKeys: { privateKey: asPriv, publicKey: asPublicKey } },
    );
    expect(b64urlEncode(body)).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
  });

  it("round-trips: the browser can decrypt what we send", async () => {
    const b = await browserSubscription();
    const msg = JSON.stringify({ title: "NGB-2026-00012: Gate-out confirmed", body: "Gate-out for MSKU1234565 on 12 Nov, 14:30." });
    const body = await encryptPayload(b.keys, utf8(msg));
    const out = await decrypt(body, b.ua.privateKey, b.uaPublic, b.auth);
    expect(out.text).toBe(msg);
    expect(out.rs).toBe(4096);
  });

  it("uses fresh keys and salt for every message", async () => {
    const b = await browserSubscription();
    const [x, y] = await Promise.all([encryptPayload(b.keys, utf8("same")), encryptPayload(b.keys, utf8("same"))]);
    expect(b64urlEncode(x)).not.toBe(b64urlEncode(y));
  });

  it("refuses bad subscription keys and oversized payloads", async () => {
    const b = await browserSubscription();
    await expect(encryptPayload({ ...b.keys, auth: "c2hvcnQ" }, utf8("x"))).rejects.toThrow(/auth/);
    await expect(encryptPayload({ ...b.keys, p256dh: b64urlEncode(new Uint8Array(65)) }, utf8("x"))).rejects.toThrow(/p256dh/);
    await expect(encryptPayload(b.keys, new Uint8Array(4000))).rejects.toThrow(/too large/);
  });
});

describe("VAPID (RFC 8292)", () => {
  it("signs a JWT for the push service origin that verifies with the public key", async () => {
    const v = await vapidKeys();
    const now = 1_800_000_000;
    const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc:def", v.keys, now);
    const m = header.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/)!;
    expect(m).toBeTruthy();
    expect(m[4]).toBe(v.keys.publicKey);
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(m[2])));
    expect(claims).toEqual({ aud: "https://fcm.googleapis.com", exp: now + 43200, sub: "mailto:ops@ngb.example" });
    const ok = await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, v.kp.publicKey, b64urlDecode(m[3]), utf8(`${m[1]}.${m[2]}`));
    expect(ok).toBe(true);
  });
});

describe("push endpoints and responses", () => {
  it("only sends to known push services over https (SSRF guard)", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/x")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/QO2x")).toBe(true);
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.evil.test/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://169.254.169.254/latest")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://push.example.test/x", ["push.example.test"])).toBe(true);
  });

  it("classifies push service responses", async () => {
    const v = await vapidKeys();
    const b = await browserSubscription();
    const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/t1", ...b.keys };
    const reply = (status: number, headers: Record<string, string> = {}) =>
      (async () => new Response(status === 201 ? null : "x", { status, headers })) as unknown as typeof fetch;
    expect(await sendPush(sub, "{}", v.keys, { fetchImpl: reply(201, { location: "msg-1" }) })).toMatchObject({ ok: true, messageId: "msg-1" });
    expect(await sendPush(sub, "{}", v.keys, { fetchImpl: reply(410) })).toMatchObject({ ok: false, gone: true, transient: false });
    expect(await sendPush(sub, "{}", v.keys, { fetchImpl: reply(404) })).toMatchObject({ ok: false, gone: true });
    expect(await sendPush(sub, "{}", v.keys, { fetchImpl: reply(429) })).toMatchObject({ ok: false, transient: true });
    expect(await sendPush(sub, "{}", v.keys, { fetchImpl: reply(503) })).toMatchObject({ ok: false, transient: true });
    expect(await sendPush(sub, "{}", v.keys, { fetchImpl: reply(403) })).toMatchObject({ ok: false, transient: false, gone: false });
    const offline = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect(await sendPush(sub, "{}", v.keys, { fetchImpl: offline })).toMatchObject({ ok: false, transient: true, code: "push_network" });
    expect(await sendPush({ ...sub, endpoint: "https://evil.test/x" }, "{}", v.keys, { fetchImpl: reply(201) }))
      .toMatchObject({ ok: false, gone: true, code: "push_endpoint_refused" });
  });

  it("sends the encrypted body with the required headers", async () => {
    const v = await vapidKeys();
    const b = await browserSubscription();
    let seen: { url: string; init: RequestInit } | null = null;
    const capture = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(null, { status: 201 }); }) as unknown as typeof fetch;
    await sendPush({ endpoint: "https://fcm.googleapis.com/fcm/send/t2", ...b.keys }, '{"title":"Hi"}', v.keys, { fetchImpl: capture, topic: "shipment-1" });
    const h = seen!.init.headers as Record<string, string>;
    expect(h["Content-Encoding"]).toBe("aes128gcm");
    expect(h.TTL).toBe("86400");
    expect(h.Topic).toBe("shipment-1");
    expect(h.Authorization).toMatch(/^vapid t=/);
    expect(seen!.init.redirect).toBe("manual");
    const out = await decrypt(seen!.init.body as Uint8Array, b.ua.privateKey, b.uaPublic, b.auth);
    expect(out.text).toBe('{"title":"Hi"}');
  });
});

describe("bytes", () => {
  it("base64url round-trips and compares secrets in constant time", () => {
    const x = crypto.getRandomValues(new Uint8Array(33));
    expect(b64urlDecode(b64urlEncode(x))).toEqual(x);
    expect(() => b64urlDecode("not base64!")).toThrow();
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "x")).toBe(false);
  });
});
