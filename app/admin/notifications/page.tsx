import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BellRing, MessageCircle } from "lucide-react";
import { requireStaff } from "@/lib/dal/session";
import { getDeliveryStats, listFailedDeliveries, type FailedDelivery } from "@/lib/dal/notifications";
import { retryDelivery } from "@/lib/actions/notifications";
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
  await requireStaff("admin", "ops_manager");
  const sp = await searchParams;
  const [stats, failed] = await Promise.all([getDeliveryStats(), listFailedDeliveries()]);

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Push and WhatsApp delivery in the last 24 hours. Failed messages are kept here until someone retries them."
      />
      <div className="flex flex-col gap-6">
        {sp.retry === "ok" && <FormAlert kind="success">Queued again. The sender will try within a minute.</FormAlert>}
        {sp.retry === "failed" && <FormAlert kind="error">That message could not be retried. It may already have been retried.</FormAlert>}

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
