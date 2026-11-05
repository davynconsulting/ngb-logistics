/* Browser-side helpers for the service worker and Web Push. Import from client components only. */

export type PushSupport =
  | "supported"
  | "ios-install"   // iPhone/iPad in the browser: push works only after "Add to Home Screen" (iOS 16.4+)
  | "unsupported";

export function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  const capable = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (capable) return "supported";
  if (isIos() && !isStandalone()) return "ios-install";
  return "unsupported";
}

export function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  } catch {
    return null;
  }
}

/** This device's current subscription, if any (waits at most `ms` for the service worker). */
export async function currentSubscription(ms = 3000): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const ready = navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription());
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));
  try { return await Promise.race([ready, timeout]); } catch { return null; }
}

export async function subscribeDevice(vapidPublicKey: string): Promise<PushSubscription> {
  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(vapidPublicKey) });
}
