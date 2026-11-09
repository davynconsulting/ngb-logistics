import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BellRing, MessageCircle } from "lucide-react";
import { requireStaff } from "@/lib/dal/session";
import { getDeliveryStats, getNotificationHealth, listFailedDeliveries, type FailedDelivery, type NotificationHealth } from "@/lib/dal/notifications";
import { retryDelivery, retryFailedSince, setSenderPaused } from "@/lib/actions/notifications";
import { RETRY_WINDOWS } from "@/lib/domain/notifications";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { PageHeader } from "@/components/layout/page-header";
import { FormAlert } from "@/components/auth/form-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Notifications" };

const STAT_LABELS = [
  ["sent", "Sent"], ["pending", "Waiting"], ["sending", "Sending"], ["suppressed", "Not needed"], ["failed", "Failed"],
] as const;

export default function NotificationsPage({ searchParams }: PageProps<"/admin/notifications">) {
  return (
    <Suspense>
      <Health searchParams={searchParams} />
    </Suspense>
  );
}

async function Health({ searchParams }: Pick<PageProps<"/admin/notifications">, "searchParams">) {
  const user = await requireStaff("admin", "ops_manager");
  const sp = await searchParams;
  const [stats, failed, health] = await Promise.all([getDeliveryStats(), listFailedDeliveries(), getNotificationHealth()]);
  const bulk = typeof sp.bulk === "string" ? sp.bulk : undefined;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Push and WhatsApp delivery in the last 24 hours. Failed messages are kept here until someone retries them."
      />
      <div className="flex flex-col gap-6">
        {sp.retry === "ok" && <FormAlert kind="success">Queued again. The sender will try within a minute.</FormAlert>}
        {sp.retry === "failed" && <FormAlert kind="error">That message could not be retried. It may already have been retried.</FormAlert>}
        {bulk && /^\d+$/.test(bulk) && <FormAlert kind="success">{bulk === "0" ? "Nothing to retry in that period." : `${bulk} message${bulk === "1" ? "" : "s"} queued again. The sender works through them within a few minutes.`}</FormAlert>}
        {bulk === "failed" && <FormAlert kind="error">The messages could not be queued again. Please try again.</FormAlert>}
        {sp.pause === "on" && <FormAlert kind="success">Sending is paused. Messages keep queuing.</FormAlert>}
        {sp.pause === "off" && <FormAlert kind="success">Sending resumed. Waiting messages go out within a minute.</FormAlert>}
        {sp.pause === "failed" && <FormAlert kind="error">The pause switch could not be changed.</FormAlert>}

        <HealthPanel h={health} canPause={user.role === "admin"} />

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {STAT_LABELS.map(([k, label]) => (
            <div key={k} className="rounded-lg border bg-card p-4">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className={`mt-1 text-2xl font-semibold tabular-nums ${k === "failed" && stats.last24h.failed ? "text-destructive" : ""}`}>
                {stats.last24h[k]}
              </dd>
            </div>
          ))}
        </dl>
        <p className="-mt-3 text-xs text-muted-foreground">
          &ldquo;Not needed&rdquo; means there was nothing to deliver to: no device registered for push, or WhatsApp consent withdrawn.
          The in-app notification is always kept.
        </p>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Failed messages ({stats.failedTotal})</h2>
          {stats.failedTotal > 0 && <BulkRetry />}
          {failed.length === 0 ? (
            <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">No failed messages.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {failed.map((d) => <FailedItem key={d.id} d={d} />)}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

const LEVEL = {
  ok: "border-success/30 bg-success/10",
  warning: "border-warning/50 bg-warning/15",
  error: "border-destructive/30 bg-destructive/10",
} as const;

/** Is the sender keeping up? Shown first, so an outage is obvious (AC-18). */
function HealthPanel({ h, canPause }: { h: NotificationHealth; canPause: boolean }) {
  const v = h.verdict;
  return (
    <section aria-labelledby="sender-health" className={`flex flex-col gap-3 rounded-lg border p-4 ${LEVEL[v.level]}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="sender-health" className="font-medium" {...(v.level === "error" ? { role: "alert" } : {})}>{v.title}</h2>
          <p className="text-sm">{v.detail}</p>
        </div>
        {canPause ? (
          <form action={setSenderPaused.bind(null, !h.sender_paused)}>
            <Button type="submit" size="sm" variant="outline">{h.sender_paused ? "Resume sending" : "Pause sending"}</Button>
          </form>
        ) : h.sender_paused ? <p className="text-xs">An admin can resume sending.</p> : null}
      </div>
    </section>
  );
}

/** After an outage: put every failed message queued in a period back in the queue at once. */
function BulkRetry() {
  return (
    <form action={retryFailedSince} className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-end">
      <div className="flex flex-1 flex-col gap-1.5">
        <Label htmlFor="bulk-hours">Retry failed messages queued in the</Label>
        <NativeSelect id="bulk-hours" name="hours" defaultValue="24">
          {RETRY_WINDOWS.map((w) => <option key={w.hours} value={w.hours}>{w.label}</option>)}
        </NativeSelect>
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        <Label htmlFor="bulk-channel">Channel</Label>
        <NativeSelect id="bulk-channel" name="channel" defaultValue="all">
          <option value="all">Push and WhatsApp</option>
          <option value="push">Push only</option>
          <option value="whatsapp">WhatsApp only</option>
        </NativeSelect>
      </div>
      <Button type="submit" variant="outline">Retry all</Button>
    </form>
  );
}

function FailedItem({ d }: { d: FailedDelivery }) {
  const n = d.notification;
  const Icon = d.channel === "push" ? BellRing : MessageCircle;
  return (
    <li className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex items-center gap-2 font-medium">
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="break-words">{n?.rule?.description ?? n?.template_key ?? "Notification"}</span>
          </p>
          <p className="text-sm text-muted-foreground">
            To {n?.recipient?.full_name ?? "a user"}
            {n?.recipient?.role && ` (${n.recipient.role === "client" ? n.recipient.organization?.legal_name ?? "client" : ROLE_LABELS[n.recipient.role]})`}
            {n?.shipment && n.shipment_id && (
              <> · <Link href={`/admin/shipments/${n.shipment_id}`} className="underline underline-offset-4">{n.shipment.shipment_reference}</Link></>
            )}
          </p>
        </div>
        <Badge variant="secondary">{d.channel === "push" ? "Push" : "WhatsApp"}</Badge>
      </div>
      <p className="text-sm">
        <span className="font-mono text-xs">{d.error_code ?? "error"}</span>
        {d.error_detail && <span className="text-muted-foreground">: {d.error_detail}</span>}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Queued {formatDateTime(d.created_at)} · {d.attempt_count} attempt{d.attempt_count === 1 ? "" : "s"}
          {d.last_attempt_at && ` · last ${formatDateTime(d.last_attempt_at)}`}
        </span>
        <form action={retryDelivery.bind(null, d.id)}>
          <Button type="submit" size="sm" variant="outline">Retry</Button>
        </form>
      </div>
      {d.attempts.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Attempt log</summary>
          <ol className="mt-2 flex flex-col gap-1">
            {d.attempts.map((a) => (
              <li key={a.id} className="break-words">
                {formatDateTime(a.attempted_at)}: {a.ok ? "delivered" : `${a.error_code ?? "failed"}${a.error_detail ? `: ${a.error_detail}` : ""}`}
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}
