import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireStaff } from "@/lib/dal/session";
import { listOpenExceptions } from "@/lib/dal/operations";
import { createClient } from "@/lib/supabase/server";
import { QUEUE_FILTERS, canRunSlaCheck, parseQueueFilter, sortQueue } from "@/lib/domain/operations";
import { runSlaCheck } from "@/lib/actions/operations";
import { PageHeader } from "@/components/layout/page-header";
import { ExceptionSummary } from "@/components/operations/exception-card";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Exceptions" };

const ROLES = ["admin", "ops_manager", "doc_officer", "clearing_agent", "transport_coord", "finance"] as const;

export default function ExceptionsPage({ searchParams }: PageProps<"/admin/exceptions">) {
  return (
    <Suspense>
      <Queue searchParams={searchParams} />
    </Suspense>
  );
}

async function Queue({ searchParams }: Pick<PageProps<"/admin/exceptions">, "searchParams">) {
  const user = await requireStaff(...ROLES);
  const sp = await searchParams;
  const filter = parseQueueFilter(sp.filter);
  const supabase = await createClient();
  const [rows, { data: catalogue }] = await Promise.all([
    listOpenExceptions({ filter, userId: user.id }),
    supabase.from("milestone_catalogue").select("milestone_type, label"),
  ]);
  const labels = new Map((catalogue ?? []).map((c) => [c.milestone_type as string, c.label]));
  const queue = sortQueue(rows);
  const scan = typeof sp.scan === "string" ? sp.scan : undefined;
  const [opened, escalated, cleared] = scan && scan !== "failed" ? scan.split("-").map(Number) : [];

  return (
    <>
      <PageHeader
        title="Exceptions"
        description="Open issues needing follow-up: escalated first, then by severity and follow-up date"
        actions={canRunSlaCheck(user.role) && (
          <form action={runSlaCheck}><Button type="submit" variant="outline">Run SLA check now</Button></form>
        )}
      />
      <div className="flex flex-col gap-4">
        {scan === "failed" && <FormAlert kind="error">The SLA check could not run. Please try again.</FormAlert>}
        {scan && scan !== "failed" && (
          <FormAlert kind="success">SLA check done: {opened} opened, {escalated} escalated, {cleared} cleared.</FormAlert>
        )}
        <nav aria-label="Filter" className="flex flex-wrap gap-2">
          {QUEUE_FILTERS.map((f) => (
            <Link key={f.value} href={f.value === "open" ? "/admin/exceptions" : `/admin/exceptions?filter=${f.value}`}
              aria-current={filter === f.value ? "page" : undefined}
              className={cn("rounded-full border px-3 py-1 text-sm", filter === f.value ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
              {f.label}
            </Link>
          ))}
        </nav>
        {queue.length === 0 ? (
          <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">No open exceptions here.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {queue.map((x) => (
              <li key={x.id} className="rounded-lg border bg-card p-4">
                <ExceptionSummary x={x} timeZone="Africa/Kigali" milestoneLabel={(t) => labels.get(t) ?? t}
                  shipment={{ id: x.shipment_id, reference: x.shipment?.shipment_reference ?? "Shipment", client: x.shipment?.client?.legal_name }} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
