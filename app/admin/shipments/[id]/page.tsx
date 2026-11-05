import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Upload } from "lucide-react";
import { requireStaff } from "@/lib/dal/session";
import { getShipment } from "@/lib/dal/shipments";
import { getMilestones } from "@/lib/dal/milestones";
import { Constants } from "@/lib/supabase/database.types";
import {
  CUSTOMS_STATUS_LABELS, DELIVERY_STATUS_LABELS, RETURN_STATUS_LABELS, TRANSPORT_STATUS_LABELS,
  canOverride, milestoneOptions,
} from "@/lib/domain/milestones";
import { RecordMilestoneForm } from "@/components/milestones/record-form";
import { getEtaHistory, getShipmentExceptions, getTransport, listDrivers, listRoutes } from "@/lib/dal/operations";
import { listActiveStaff } from "@/lib/dal/clients";
import {
  canAssignTransport, canManageExceptions, canReviseEta, etaEditable, transportCandidates,
} from "@/lib/domain/operations";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { EtaPanel } from "@/components/operations/eta-panel";
import { TransportPanel } from "@/components/operations/transport-panel";
import { ExceptionPanel } from "@/components/operations/exception-panel";
import { MilestoneTimeline } from "@/components/milestones/timeline";
import { formatDate, formatDateTime } from "@/lib/format";
import { SHIPMENT_STATUS_LABELS } from "@/lib/domain/status-labels";
import {
  DOCUMENT_TYPE_LABELS, DOC_STATUS_LABELS, canReviewDocuments, uploadTypesFor,
  type DocStatus, type DocumentType,
} from "@/lib/domain/documents";
import { CONTAINER_SIZE_TYPES } from "@/lib/validation/shipment";
import { PageHeader } from "@/components/layout/page-header";
import { ShipmentStatusBadge } from "@/components/shipments/status-badge";
import { DocumentList } from "@/components/documents/document-list";
import { DocumentUploadForm } from "@/components/documents/upload-form";
import { FormAlert } from "@/components/auth/form-alert";
import { Badge } from "@/components/ui/badge";
import { listShipmentInvoices } from "@/lib/dal/finance";
import { canReadFinance, canWriteFinance } from "@/lib/domain/finance";
import { ShipmentFinance } from "@/components/finance/shipment-finance";

export const metadata: Metadata = { title: "Shipment" };

const sizeLabel = (s: string | null) => CONTAINER_SIZE_TYPES.find((x) => x.value === s)?.label ?? "—";
const docStatusClass: Record<DocStatus, string> = {
  missing: "bg-warning/25 text-warning-foreground",
  received: "bg-info/15 text-info",
  under_review: "bg-info/15 text-info",
  complete: "bg-success/15 text-success",
  rejected: "bg-destructive/10 text-destructive",
};
function DocStatusBadge({ status }: { status: DocStatus }) {
  return <Badge variant="secondary" className={docStatusClass[status]}>{DOC_STATUS_LABELS[status]}</Badge>;
}

export default function ShipmentPage({ params, searchParams }: PageProps<"/admin/shipments/[id]">) {
  return (
    <Suspense>
      <ShipmentDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ShipmentDetail({ params, searchParams }: PageProps<"/admin/shipments/[id]">) {
  const user = await requireStaff();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const canTransport = canAssignTransport(user.role);
  const canExceptions = canManageExceptions(user.role);
  const financeReader = canReadFinance(user.role);
  const [s, milestones, etaHistory, transport, exceptions, routes, drivers, staff, invoices] = await Promise.all([
    getShipment(id), getMilestones(id), getEtaHistory(id), getTransport(id),
    user.role === "driver" ? Promise.resolve([]) : getShipmentExceptions(id),
    canTransport ? listRoutes() : Promise.resolve([]),
    canTransport ? listDrivers() : Promise.resolve([]),
    canExceptions ? listActiveStaff() : Promise.resolve([]),
    financeReader ? listShipmentInvoices(id) : Promise.resolve([]),
  ]);
  if (!s) notFound(); // also when RLS hides it (e.g. not assigned to this agent)
  const tz = s.client?.timezone ?? "Africa/Kigali";

  const uploadTypes = uploadTypesFor(user.role);
  const canReview = canReviewDocuments(user.role);
  const wanted = typeof sp.upload === "string" ? sp.upload : undefined;
  const defaultType = uploadTypes.find((t) => t === wanted);
  const containers = s.containers.map((c) => ({ id: c.id, label: c.container_number }));

  // Milestone form: options for this role, with hints that mirror the database rules
  const options = milestoneOptions(milestones.catalogue, user.role, s,
    s.containers.map((c) => ({ id: c.id, label: c.container_number, operational_status: c.operational_status })),
    Constants.public.Enums.shipment_status);
  const evidence = s.documents
    .filter((d) => !s.documents.some((x) => x.replaces_document_id === d.id))
    .map((d) => ({ id: d.id, label: `${DOCUMENT_TYPE_LABELS[d.document_type]} · ${d.file_name}` }));

  const milestoneLabel = (t: string) => milestones.catalogue.find((c) => c.milestone_type === t)?.label ?? t;
  const containerLabel = (cid: string) => containers.find((c) => c.id === cid)?.label ?? "Container";
  const withTruck = new Set(transport.filter((a) => a.status === "active").flatMap((a) => a.containers.map((c) => c.container_id)));
  const staffOptions = staff.filter((p) => p.role !== "driver")
    .map((p) => ({ id: p.id, label: `${p.full_name || p.email} (${ROLE_LABELS[p.role]})` }));

  const facts: [string, React.ReactNode][] = [
    ["Client", s.client?.legal_name],
    ["Bill of lading", s.bl_number ?? "Not yet received"],
    ["Booking", s.booking_reference ?? "—"],
    ["Carrier / vessel", [s.shipping_line, s.vessel_name, s.voyage_number].filter(Boolean).join(" · ") || "—"],
    ["Port of discharge", `${s.origin?.name ?? ""}${s.origin_terminal ? ` · ${s.origin_terminal}` : ""}`],
    ["Destination", [s.destination_city, s.destination_country].join(", ")],
    ["Cargo", s.cargo_description ?? "—"],
    ["Packages / weight", `${s.package_count ?? "—"} pkgs · ${s.gross_weight_kg != null ? `${Number(s.gross_weight_kg).toLocaleString("en")} kg` : "—"}`],
    ["Planned vessel arrival", formatDate(s.planned_vessel_arrival, tz)],
    ["Responsible", s.owner?.full_name || s.owner?.email || "—"],
    ["Documents", <DocStatusBadge key="d" status={s.doc_status} />],
    ["Customs", CUSTOMS_STATUS_LABELS[s.customs_status]],
    ["Actual vessel arrival", formatDateTime(s.actual_vessel_arrival, tz)],
  ];

  return (
    <>
      <PageHeader
        title={<span className="font-mono">{s.shipment_reference}</span>}
        description={`Registered ${formatDate(s.created_at, tz)}`}
        back={{ href: "/admin/shipments", label: "Shipments" }}
        actions={<ShipmentStatusBadge status={s.overall_status} exception={s.has_open_exception} />}
      />
      <div className="flex flex-col gap-6">
        {sp.created && <FormAlert kind="success">Shipment registered as {SHIPMENT_STATUS_LABELS[s.overall_status].toLowerCase()}. Record &ldquo;Shipment confirmed&rdquo; below when the booking is confirmed.</FormAlert>}

        <section className="rounded-lg border bg-card p-4 sm:p-6">
          <h2 className="mb-3 text-lg font-medium">Details</h2>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {facts.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="text-sm break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <EtaPanel shipmentId={s.id} current={s.current_eta} reason={etaHistory[0]?.reason ?? s.eta_reason} updatedAt={s.eta_updated_at}
            history={etaHistory} timeZone={tz} canEdit={canReviseEta(user.role) && etaEditable(s.overall_status)} />
          <TransportPanel shipmentId={s.id} assignments={transport} containerLabel={containerLabel} timeZone={tz}
            canAssign={canTransport}
            form={canTransport ? {
              shipmentId: s.id,
              candidates: transportCandidates(s.containers, withTruck).map((c) => ({
                id: c.id, label: c.container_number, status: SHIPMENT_STATUS_LABELS[c.operational_status], needsOverride: c.needsOverride })),
              routes: routes.map((r) => ({ id: r.id, name: r.name })),
              drivers: drivers.map((d) => ({ id: d.id, label: d.full_name || d.email || "Driver" })),
              canOverride: canOverride(user.role),
            } : null} />
        </div>

        <section className="rounded-lg border bg-card p-4 sm:p-6">
          <h2 className="mb-3 text-lg font-medium">Containers ({s.containers.length})</h2>
          <ul className="divide-y">
            {s.containers.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-medium">{c.container_number}</span>
                  <ShipmentStatusBadge status={c.operational_status} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {sizeLabel(c.size_type)}{c.seal_number ? ` · seal ${c.seal_number}` : ""}
                  {c.location_name ? ` · ${c.location_name}` : ""}
                </p>
                <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  <span>Transport: {TRANSPORT_STATUS_LABELS[c.transport_status]}</span>
                  <span>Delivery: {DELIVERY_STATUS_LABELS[c.delivery_status]}</span>
                  <span>Return: {RETURN_STATUS_LABELS[c.return_status]}</span>
                  {c.gate_out_at && <span>Gate-out {formatDateTime(c.gate_out_at, tz)}</span>}
                  {c.delivery_at && <span>Delivered {formatDateTime(c.delivery_at, tz)}</span>}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {options.length > 0 && (
            <section id="record" className="h-fit scroll-mt-20 rounded-lg border bg-card p-4 sm:p-6">
              <h2 className="mb-3 text-lg font-medium">Record a milestone</h2>
              <RecordMilestoneForm shipmentId={s.id} options={options} containers={s.containers.map((c) => ({
                id: c.id, label: c.container_number, status: SHIPMENT_STATUS_LABELS[c.operational_status] }))}
                evidence={evidence} canOverride={canOverride(user.role)} />
            </section>
          )}
          <section className={`rounded-lg border bg-card p-4 sm:p-6 ${options.length ? "" : "lg:col-span-2"}`}>
            <h2 className="mb-4 text-lg font-medium">Timeline</h2>
            <MilestoneTimeline data={milestones} containers={containers} timeZone={tz} user={user} />
          </section>
        </div>

        {user.role !== "driver" && (
          <ExceptionPanel shipmentId={s.id} exceptions={exceptions} containers={containers} staff={staffOptions}
            user={user} timeZone={tz} milestoneLabel={milestoneLabel} canManage={canExceptions} />
        )}

        {financeReader && (
          <ShipmentFinance shipmentId={s.id} status={s.finance_status} invoices={invoices}
            canCreate={canWriteFinance(user.role) && s.overall_status !== "closed"} />
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <section className="h-fit rounded-lg border bg-card p-4 sm:p-6">
            <h2 className="mb-3 text-lg font-medium">Document checklist</h2>
            <ul className="flex flex-col gap-3">
              {s.document_requirements.map((r) => {
                const canUpload = uploadTypes.includes(r.document_type as DocumentType) && (r.status === "missing" || r.status === "rejected");
                return (
                  <li key={r.id} className="flex flex-col gap-1 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span>{DOCUMENT_TYPE_LABELS[r.document_type]}{!r.is_required && <span className="text-muted-foreground"> (optional)</span>}</span>
                      <DocStatusBadge status={r.status} />
                    </div>
                    {r.client_note && <p className="text-xs text-muted-foreground">{r.client_note}</p>}
                    {canUpload && (
                      <Link href={`?upload=${r.document_type}#upload`} scroll={false}
                        className="inline-flex items-center gap-1 self-start text-xs font-medium text-primary underline-offset-4 hover:underline">
                        <Upload className="size-3" aria-hidden /> Upload
                      </Link>
                    )}
                  </li>
                );
              })}
              {s.document_requirements.length === 0 && <li className="text-sm text-muted-foreground">No required documents.</li>}
            </ul>
          </section>

          <section className="flex flex-col gap-6 rounded-lg border bg-card p-4 sm:p-6">
            <div>
              <h2 className="mb-3 text-lg font-medium">Documents</h2>
              <DocumentList shipmentId={s.id} documents={s.documents} containers={containers} timeZone={tz}
                uploadTypes={uploadTypes} canReview={canReview} />
            </div>
            {uploadTypes.length > 0 && (
              <div id="upload" className="scroll-mt-20 border-t pt-4">
                <h3 className="mb-3 font-medium">Upload a document</h3>
                <DocumentUploadForm key={defaultType ?? "none"} shipmentId={s.id} types={uploadTypes}
                  containers={containers} defaultType={defaultType} />
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
