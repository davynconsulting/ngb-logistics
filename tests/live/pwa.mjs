// PWA: manifest, service worker, offline page, security headers, push device registration.
// Runs last in run.mjs: it ends with a sign-out.
import { APP, action, check, finish, formAction, login, svc } from "./_shared.mjs";

console.log("PWA (manifest, service worker, push devices):");
const stamp = Date.now().toString().slice(-6);

const m = await (await fetch(`${APP}/manifest.webmanifest`)).json();
check("manifest: standalone, starts in the portal, has 192/512/maskable icons",
  m.display === "standalone" && m.start_url === "/portal" && m.icons.some((i) => i.sizes === "192x192")
  && m.icons.some((i) => i.purpose === "maskable"), JSON.stringify(m).slice(0, 120));
const sw = await fetch(`${APP}/sw.js`);
check("service worker served as JS, never cached, strict CSP",
  /javascript/.test(sw.headers.get("content-type")) && /no-store/.test(sw.headers.get("cache-control") ?? "")
  && /script-src 'self'/.test(sw.headers.get("content-security-policy") ?? ""));
check("offline page available without signing in", (await fetch(`${APP}/offline.html`, { redirect: "manual" })).status === 200);
const home = await fetch(APP);
check("security headers on pages",
  home.headers.get("x-frame-options") === "DENY" && home.headers.get("x-content-type-options") === "nosniff"
  && /frame-ancestors 'none'/.test(home.headers.get("content-security-policy") ?? "") && /geolocation=\(\)/.test(home.headers.get("permissions-policy") ?? ""));

const aline = await login("aline@akagera.example");
const jean = await login("jean@kivuhardware.example");
const { data: people } = await svc.from("profiles").select("id, email").in("email", ["aline@akagera.example", "jean@kivuhardware.example"]);
const idOf = (e) => people.find((p) => p.email === e).id;
const keys = { p256dh: "B" + "x".repeat(86), auth: "y".repeat(22) };
const endpoint = `https://fcm.googleapis.com/fcm/send/live-test-${stamp}`;
const owner = async () => (await svc.from("push_subscriptions").select("user_id").eq("endpoint", endpoint).maybeSingle()).data?.user_id;

let r = await action(aline, "registerPushDevice", [{ endpoint, keys }, "live-test"], "/portal/settings");
check("client turns push on for this device", r.value?.ok === true && (await owner()) === idOf("aline@akagera.example"), JSON.stringify(r.value));
r = await action(aline, "registerPushDevice", [{ endpoint: "https://evil.example/collect", keys }, "live-test"], "/portal/settings");
check("unknown push services are refused (SSRF guard)", r.value?.ok === false, JSON.stringify(r.value));
r = await action(null, "registerPushDevice", [{ endpoint, keys }, "live-test"], "/portal/settings");
check("signed-out callers cannot register", r.value?.ok !== true);

r = await action(jean, "registerPushDevice", [{ endpoint, keys }, "live-test"], "/portal/settings");
check("shared phone: another client signs in and turns push on → device moves to them",
  r.value?.ok === true && (await owner()) === idOf("jean@kivuhardware.example"), JSON.stringify(r.value));
r = await action(aline, "removePushDevice", [endpoint], "/portal/settings");
check("the first client cannot remove the other client's device", r.value?.ok === true && (await owner()) === idOf("jean@kivuhardware.example"));

const renewed = `${endpoint}-renewed`;
const renew = await fetch(`${APP}/api/push/renew`, { method: "POST",
  headers: { cookie: jean.cookie, origin: APP, "content-type": "application/json" },
  body: JSON.stringify({ oldEndpoint: endpoint, subscription: { endpoint: renewed, keys } }) });
check("service worker renewal swaps the old endpoint for the new one", renew.status === 200 && !(await owner())
  && (await svc.from("push_subscriptions").select("user_id").eq("endpoint", renewed).single()).data?.user_id === idOf("jean@kivuhardware.example"), String(renew.status));
const foreign = await fetch(`${APP}/api/push/renew`, { method: "POST",
  headers: { cookie: jean.cookie, origin: "https://evil.example", "content-type": "application/json" },
  body: JSON.stringify({ subscription: { endpoint: `${endpoint}-x`, keys } }) });
check("…cross-site renewal refused", foreign.status === 403);

// sign-out removes this device's subscription (last: it ends the session)
const out = await formAction(jean, "signOut", [], { push_endpoint: renewed }, "/portal");
const left = await svc.from("push_subscriptions").select("id").eq("endpoint", renewed);
check("signing out removes this device's push subscription", (left.data ?? []).length === 0, `${out.status} ${JSON.stringify(left.data)}`);

await svc.from("push_subscriptions").delete().like("endpoint", `https://fcm.googleapis.com/fcm/send/live-test-${stamp}%`);
finish();
