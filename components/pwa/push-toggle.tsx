"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { BellOff, BellRing, Share, SquarePlus } from "lucide-react";
import { registerPushDevice, removePushDevice } from "@/lib/actions/push";
import { currentSubscription, pushSupport, subscribeDevice, type PushSupport } from "@/lib/pwa/push-client";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";

type Status = "checking" | "on" | "off" | "denied";
const noop = () => () => {};

/**
 * "Notifications on this device": turns Web Push on/off for the signed-in
 * user. Client-only (depends on the browser). On iPhone/iPad, push needs the
 * app on the home screen first, so it explains how.
 */
export function PushToggle({ vapidPublicKey }: { vapidPublicKey?: string }) {
  const support = useSyncExternalStore<PushSupport | null>(noop, pushSupport, () => null);
  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (support !== "supported") return;
    let live = true;
    currentSubscription().then((sub) => {
      if (!live) return;
      if (Notification.permission === "denied") setStatus("denied");
      else setStatus(sub ? "on" : "off");
    });
    return () => { live = false; };
  }, [support]);

  if (support === null) return <p className="text-sm text-muted-foreground">Checking this device…</p>;

  if (support === "ios-install") {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p>To get notifications on iPhone or iPad, add NGB Cargo to your home screen first (iOS 16.4 or later):</p>
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          <li>Tap <Share className="inline size-4 align-text-bottom" aria-label="Share" /> Share in Safari.</li>
          <li>Choose <SquarePlus className="inline size-4 align-text-bottom" aria-hidden /> &ldquo;Add to Home Screen&rdquo;.</li>
          <li>Open NGB Cargo from your home screen, sign in, and turn notifications on here.</li>
        </ol>
      </div>
    );
  }
  if (support === "unsupported") {
    return <p className="text-sm text-muted-foreground">This browser can&rsquo;t receive push notifications. Try Chrome, Edge, Firefox or Safari.</p>;
  }
  if (!vapidPublicKey) {
    return <p className="text-sm text-muted-foreground">Push notifications are not set up yet.</p>;
  }

  const turnOn = () => start(async () => {
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setStatus(permission === "denied" ? "denied" : "off"); return; }
      const sub = await subscribeDevice(vapidPublicKey);
      const r = await registerPushDevice(sub.toJSON(), navigator.userAgent);
      if (!r.ok) { await sub.unsubscribe().catch(() => {}); setError(r.error); return; }
      setStatus("on");
    } catch {
      setError("Could not turn on notifications on this device.");
    }
  });

  const turnOff = () => start(async () => {
    setError(null);
    const sub = await currentSubscription();
    const endpoint = sub?.endpoint;
    await sub?.unsubscribe().catch(() => {});
    const r = await removePushDevice(endpoint ?? null);
    if (!r.ok) setError(r.error);
    setStatus("off");
  });

  return (
    <div className="flex flex-col gap-3">
      {status === "denied" ? (
        <p className="flex items-start gap-2 text-sm">
          <BellOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          Notifications are blocked for this site. Allow them in your browser&rsquo;s site settings, then come back here.
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm">
            {status === "on" ? <BellRing className="size-4 text-primary" aria-hidden /> : <BellOff className="size-4 text-muted-foreground" aria-hidden />}
            {status === "checking" ? "Checking…" : status === "on" ? "On for this device" : "Off for this device"}
          </p>
          {status !== "checking" && (
            <Button type="button" size="sm" variant={status === "on" ? "outline" : "default"} disabled={pending} onClick={status === "on" ? turnOff : turnOn}>
              {pending ? "Please wait…" : status === "on" ? "Turn off" : "Turn on"}
            </Button>
          )}
        </div>
      )}
      {error && <FormAlert kind="error">{error}</FormAlert>}
    </div>
  );
}
