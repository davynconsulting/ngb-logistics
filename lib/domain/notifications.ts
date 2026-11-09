/*
 * Notification sender health (0027): how the admin screen words the state the
 * database reports. Pure, so it is unit-tested; the database decides `stalled`.
 */

/** Periods offered for "retry everything that failed since the outage began". */
export const RETRY_WINDOWS = [
  { hours: 6, label: "Last 6 hours" },
  { hours: 24, label: "Last 24 hours" },
  { hours: 72, label: "Last 3 days" },
  { hours: 168, label: "Last 7 days" },
] as const;

export type HealthInput = {
  pending_count: number;
  oldest_pending_at: string | null;
  last_sent_at: string | null;
  failed_24h: number;
  sender_paused: boolean;
  sender_configured: boolean;
  stalled: boolean;
};

export type HealthVerdict = { level: "ok" | "warning" | "error"; title: string; detail: string };

function minutesSince(iso: string, now: number) {
  return Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
}

export function ago(iso: string | null, now: number): string {
  if (!iso) return "never";
  const m = minutesSince(iso, now);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.floor(h / 24)} days ago`;
}

export function healthVerdict(h: HealthInput, now: number): HealthVerdict {
  const waiting = `${h.pending_count} message${h.pending_count === 1 ? "" : "s"} waiting`;
  const oldest = h.oldest_pending_at ? `, oldest queued ${ago(h.oldest_pending_at, now)}` : "";
  const keep = "Milestones and in-app notifications are not affected; messages keep queuing for up to 24 hours.";
  if (h.sender_paused) {
    return { level: "warning", title: "Sending is paused", detail: `${waiting}${oldest}. ${keep} Turn the pause off in settings when the provider is back.` };
  }
  if (!h.sender_configured) {
    return { level: "error", title: "The sender is not set up", detail: `${waiting}${oldest}. The sender address or secret is missing from the database vault, so nothing is sent. ${keep}` };
  }
  if (h.stalled) {
    return { level: "error", title: "Messages are not going out", detail: `${waiting}${oldest}; last successful send ${ago(h.last_sent_at, now)}. ${keep} Check the sender function and the provider.` };
  }
  if (h.failed_24h > 0) {
    return { level: "warning", title: "Sending works, with failures", detail: `${h.failed_24h} failed in the last 24 hours (listed below). Last successful send ${ago(h.last_sent_at, now)}.` };
  }
  return { level: "ok", title: "Sending normally", detail: `${waiting}. Last successful send ${ago(h.last_sent_at, now)}.` };
}
