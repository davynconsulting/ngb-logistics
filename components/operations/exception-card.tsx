import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { EXCEPTION_TYPE_LABELS, SEVERITY_LABELS, type ExceptionSeverity } from "@/lib/domain/operations";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const SEVERITY_CLASS: Record<ExceptionSeverity, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-info/15 text-info",
  high: "bg-warning/25 text-warning-foreground",
  critical: "bg-destructive/10 text-destructive",
};

export function SeverityBadge({ severity }: { severity: ExceptionSeverity }) {
  return <Badge variant="secondary" className={cn("border-transparent", SEVERITY_CLASS[severity])}>{SEVERITY_LABELS[severity]}</Badge>;
}

type Row = {
  id: string; exception_type: keyof typeof EXCEPTION_TYPE_LABELS; severity: ExceptionSeverity; status: string; title: string;
  source: string; next_action: string | null; next_follow_up_at: string | null; opened_at: string; escalated_at: string | null;
  owner: { full_name: string; email: string | null } | null;
  container: { container_number: string } | null;
  last_event: { milestone_type: string; event_at: string } | null;
  follow_up_due: boolean;
};

/** The facts AC-10 asks for: owner, reason/last event and next action. */
export function ExceptionSummary({ x, timeZone, milestoneLabel, shipment }: {
  x: Row; timeZone: string; milestoneLabel: (t: string) => string;
  shipment?: { id: string; reference: string; client?: string | null };
}) {
  const overdue = x.follow_up_due;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={x.severity} />
        {x.escalated_at && <Badge variant="secondary" className="bg-destructive/10 text-destructive"><ShieldAlert aria-hidden /> Escalated</Badge>}
        {x.status === "resolved" && <Badge variant="secondary" className="bg-success/15 text-success">Resolved</Badge>}
        <span className="font-medium">{x.title}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {EXCEPTION_TYPE_LABELS[x.exception_type]}
        {x.container && <> · <span className="font-mono">{x.container.container_number}</span></>}
        {shipment && <> · <Link className="font-mono text-primary underline-offset-4 hover:underline" href={`/admin/shipments/${shipment.id}#exceptions`}>{shipment.reference}</Link>{shipment.client ? ` · ${shipment.client}` : ""}</>}
        {" · "}{x.source === "system" ? "raised by SLA check" : "opened"} {formatDateTime(x.opened_at, timeZone)}
      </p>
      <dl className="grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
        <div><dt className="inline text-muted-foreground">Owner: </dt><dd className="inline">{x.owner?.full_name || x.owner?.email || "Unassigned"}</dd></div>
        <div><dt className="inline text-muted-foreground">Last event: </dt><dd className="inline">
          {x.last_event ? `${milestoneLabel(x.last_event.milestone_type)}, ${formatDateTime(x.last_event.event_at, timeZone)}` : "—"}
        </dd></div>
        <div><dt className="inline text-muted-foreground">Next action: </dt><dd className="inline">{x.next_action ?? "—"}</dd></div>
        <div><dt className="inline text-muted-foreground">Follow-up: </dt><dd className={cn("inline", overdue && "font-medium text-destructive")}>
          {x.next_follow_up_at ? `${formatDateTime(x.next_follow_up_at, timeZone)}${overdue ? " (due)" : ""}` : "—"}
        </dd></div>
      </dl>
    </div>
  );
}
