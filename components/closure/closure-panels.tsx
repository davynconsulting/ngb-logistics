import { CheckCircle2, CircleAlert, XCircle } from "lucide-react";
import type { AppRole } from "@/lib/auth/roles";
import type { ClosureData } from "@/lib/dal/closure";
import type { ShipmentDetail } from "@/lib/dal/shipments";
import {
  CONDITION_LABELS, INCIDENT_TYPE_LABELS, canApproveCredit, canCloseShipment, canRecordCondition, canReportIncident,
  canResolveIncident, canSetReturnTerms, isDamage, type ContainerCondition,
} from "@/lib/domain/closure";
import { RETURN_STATUS_LABELS } from "@/lib/domain/milestones";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import {
  CloseForm, ConditionForm, CreditForm, IncidentNoteForm, ReopenForm, ReportIncidentForm, ResolveIncidentForm, ReturnTermsForm,
} from "@/components/closure/forms";

function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 rounded-lg border bg-card p-4 sm:p-6">
      <h2 className="mb-3 text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}

/** Empty-container return: deadline, depot, charges, condition (delivery and return are tracked separately, AC-14). */
export function ReturnPanel({ s, role, timeZone }: { s: ShipmentDetail; role: AppRole; timeZone: string }) {
  const closed = s.overall_status === "closed";
  const open = s.containers.filter((c) => c.operational_status !== "container_returned");
  return (
    <Section title="Container return" id="return">
      <ul className="flex flex-col divide-y">
        {s.containers.map((c) => (
          <li key={c.id} className="flex flex-col gap-2 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono font-medium">{c.container_number}</span>
              <Badge variant="secondary" className={c.return_status === "return_overdue" ? "bg-destructive/10 text-destructive"
                : c.return_status === "returned" ? "bg-success/15 text-success" : ""}>{RETURN_STATUS_LABELS[c.return_status]}</Badge>
            </div>
            <p className="flex flex-wrap gap-x-3 text-muted-foreground">
              <span>Deadline: {c.return_deadline ? formatDateTime(c.return_deadline, timeZone) : "not set"}</span>
              {c.return_depot && <span>Depot: {c.return_depot}</span>}
              {c.empty_return_at && <span>Returned {formatDateTime(c.empty_return_at, timeZone)}</span>}
            </p>
            {c.return_charges_note && <p className="break-words">Charges: {c.return_charges_note}</p>}
            {c.condition && (
              <p className={isDamage(c.condition) ? "text-destructive" : ""}>
                Condition: {CONDITION_LABELS[c.condition as ContainerCondition] ?? c.condition}{c.condition_note ? `: ${c.condition_note}` : ""}
              </p>
            )}
            {!closed && canRecordCondition(role) && ["delivered", "container_returned"].includes(c.operational_status) && (
              <ConditionForm containerId={c.id} />
            )}
          </li>
        ))}
      </ul>
      {!closed && canSetReturnTerms(role) && open.length > 0 && (
        <div className="mt-4 border-t pt-4">
          <h3 className="mb-3 font-medium">Set the return deadline</h3>
          <ReturnTermsForm containers={open.map((c) => ({ id: c.id, label: c.container_number }))} />
        </div>
      )}
    </Section>
  );
}

export function IncidentsPanel({
  shipmentId, closed, data, role, timeZone, containers, evidence,
}: {
  shipmentId: string; closed: boolean; data: ClosureData; role: AppRole; timeZone: string;
  containers: { id: string; label: string }[]; evidence: { id: string; label: string }[];
}) {
  const containerLabel = (id: string | null) => containers.find((c) => c.id === id)?.label;
  return (
    <Section title={`Incidents${data.incidents.some((i) => i.status === "open") ? ` (${data.incidents.filter((i) => i.status === "open").length} open)` : ""}`} id="incidents">
      {data.incidents.length === 0 ? <p className="text-sm text-muted-foreground">No incidents.</p> : (
        <ul className="flex flex-col gap-3">
          {data.incidents.map((i) => (
            <li key={i.id} className={`flex flex-col gap-2 rounded-md border p-3 text-sm ${i.status === "open" ? "border-warning/60" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{INCIDENT_TYPE_LABELS[i.incident_type]}{containerLabel(i.container_id) && <span className="font-mono font-normal"> · {containerLabel(i.container_id)}</span>}</span>
                <Badge variant="secondary" className={i.status === "open" ? "bg-warning/25 text-warning-foreground" : "bg-success/15 text-success"}>
                  {i.status === "open" ? "Open: blocks closure" : "Resolved"}
                </Badge>
              </div>
              <p className="break-words whitespace-pre-line">{i.description}</p>
              <p className="text-xs text-muted-foreground">
                Reported {formatDateTime(i.reported_at, timeZone)} by {i.reporter?.full_name ?? "staff"}
                {i.evidence_document_ids.length > 0 && ` · ${i.evidence_document_ids.length} evidence file${i.evidence_document_ids.length === 1 ? "" : "s"}`}
              </p>
              {i.notes.length > 0 && (
                <ol className="flex flex-col gap-1 border-l-2 pl-3">
                  {i.notes.map((n) => (
                    <li key={n.id}><span className="break-words">{n.note}</span>
                      <span className="block text-xs text-muted-foreground">{n.author?.full_name ?? "staff"} · {formatDateTime(n.created_at, timeZone)}</span></li>
                  ))}
                </ol>
              )}
              {i.status === "resolved" && (
                <p className="break-words">Outcome: {i.resolution} <span className="text-xs text-muted-foreground">({i.resolver?.full_name ?? "manager"}, {formatDateTime(i.resolved_at, timeZone)})</span></p>
              )}
              {i.status === "open" && !closed && canReportIncident(role) && <IncidentNoteForm incidentId={i.id} />}
              {i.status === "open" && !closed && canResolveIncident(role) && <ResolveIncidentForm incidentId={i.id} />}
            </li>
          ))}
        </ul>
      )}
      {!closed && canReportIncident(role) && (
        <div className="mt-4 border-t pt-4">
          <h3 className="mb-3 font-medium">Record an incident</h3>
          <ReportIncidentForm shipmentId={shipmentId} containers={containers} evidence={evidence} />
        </div>
      )}
    </Section>
  );
}

/** Closure checklist (AC-15), credit approval, close and reopen, and the closure log. */
export function ClosurePanel({
  s, data, role, timeZone,
}: { s: ShipmentDetail; data: ClosureData; role: AppRole; timeZone: string }) {
  const closed = s.overall_status === "closed";
  const ready = data.checks.length > 0 && data.checks.every((c) => c.ok);
  const financeOk = data.checks.find((c) => c.check_key === "finance")?.ok;
  return (
    <Section title={closed ? "Closed" : "Closure"} id="closure">
      {closed ? (
        <p className="mb-3 text-sm">Closed {formatDateTime(s.closed_at, timeZone)}{s.closure_note ? `: ${s.closure_note}` : ""}</p>
      ) : (
        <ul className="mb-4 flex flex-col gap-2 text-sm" aria-label="Closure checklist">
          {data.checks.map((c) => (
            <li key={c.check_key} className="flex items-start gap-2">
              {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />}
              <span><span className="sr-only">{c.ok ? "Done: " : "Missing: "}</span>{c.label} <span className="text-muted-foreground">· {c.detail}</span></span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-4">
        {!closed && !financeOk && canApproveCredit(role) && <CreditForm shipmentId={s.id} />}
        {!closed && canCloseShipment(role) && (ready
          ? <CloseForm shipmentId={s.id} />
          : <p className="flex items-center gap-2 text-sm text-muted-foreground"><CircleAlert className="size-4" aria-hidden /> Closing is possible once every item is done.</p>)}
        {closed && canCloseShipment(role) && <ReopenForm shipmentId={s.id} />}
        {data.credits.length > 0 && (
          <div className="text-sm">
            <h3 className="mb-1 font-medium">Credit approvals</h3>
            <ul className="flex flex-col gap-1">
              {data.credits.map((c) => <li key={c.id} className="break-words">{c.reason} <span className="text-xs text-muted-foreground">({c.approver?.full_name ?? "finance"}, {formatDateTime(c.approved_at, timeZone)})</span></li>)}
            </ul>
          </div>
        )}
        {data.log.length > 0 && (
          <div className="text-sm">
            <h3 className="mb-1 font-medium">Closure log</h3>
            <ol className="flex flex-col gap-1">
              {data.log.map((l) => (
                <li key={l.id} className="break-words">{l.action === "closed" ? "Closed" : "Reopened"} by {l.actor?.full_name ?? "staff"}, {formatDateTime(l.occurred_at, timeZone)}{l.note ? `: ${l.note}` : ""}</li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </Section>
  );
}
