/*
 * NGB LOGISTICS service worker.
 *
 * - Push: shows the notification sent by the notify-sender edge function
 *   (payload: { title, body, url, tag, id }) and opens its link on click.
 * - Offline: page navigations fall back to /offline.html when the network is
 *   down. Nothing else is cached: shipment pages and data are per user and
 *   phones may be shared, so they are never stored on the device.
 * - Subscription renewal: if the browser rotates the push subscription, the
 *   new one is sent to /api/push/renew (same-origin, with the session cookie).
 */
const VERSION = "ngb-sw-v1";
const OFFLINE_URL = "/offline.html";
const OFFLINE_ASSETS = [OFFLINE_URL, "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(OFFLINE_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (req.mode === "navigate") {
    // network only; never cache pages (per-user data)
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }
  const url = new URL(req.url);
  if (url.origin === self.location.origin && OFFLINE_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});

/** Only app-relative paths on our own origin (no open redirects from a payload). */
function safeUrl(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/portal";
  try {
    const u = new URL(value, self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search + u.hash : "/portal";
  } catch {
    return "/portal";
  }
}

const text = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = text(data.title, 120) || "NGB LOGISTICS";
  const options = {
    body: text(data.body, 700) || "There is an update on your shipment.",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: text(data.tag, 64) || undefined,
    renotify: !!text(data.tag, 64),
    data: { url: safeUrl(data.url), id: text(data.id, 64) },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(safeUrl(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of windows) {
      if (new URL(w.url).origin === self.location.origin && "focus" in w) {
        await w.focus();
        if ("navigate" in w) return w.navigate(target);
        return;
      }
    }
    return self.clients.openWindow(target);
  })());
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const old = event.oldSubscription;
    const sub = event.newSubscription
      || (old && old.options && (await self.registration.pushManager.subscribe(old.options)));
    if (!sub) return;
    await fetch("/api/push/renew", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldEndpoint: old ? old.endpoint : null, subscription: sub.toJSON() }),
    });
  })());
});
