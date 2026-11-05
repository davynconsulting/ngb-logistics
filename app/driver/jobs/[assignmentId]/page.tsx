import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MapPin, Package, Phone, Route, Truck } from "lucide-react";
import { requireDriver } from "@/lib/dal/session";
import { getDriverCatalogue, getDriverJob, getDriverJobEvents, listMyUploads } from "@/lib/dal/driver";
import { getOrgTimezone } from "@/lib/dal/portal";
import { DRIVER_UPLOAD_TYPES, driverSteps, jobStage, telHref } from "@/lib/domain/driver";
import { DOCUMENT_TYPE_LABELS } from "@/lib/domain/documents";
import { DELIVERY_STATUS_LABELS } from "@/lib/domain/milestones";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { ShipmentStatusBadge } from "@/components/shipments/status-badge";
import { DriverStepForm } from "@/components/driver/step-form";
import { ReportProblemForm } from "@/components/driver/report-form";
import { ContactSharing } from "@/components/driver/contact-sharing";
import { DocumentUploadForm } from "@/components/documents/upload-form";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Job" };

export default function DriverJobPage({ params }: PageProps<"/driver/jobs/[assignmentId]">) {
  return (
    <Suspense fallback={<div className="flex flex-col gap-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-40 w-full" /></div>}>
      <Job params={params} />
    </Suspense>
  );
}

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-20 rounded-lg border bg-card p-4">
      <h2 className="mb-3 text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}

async function Job({ params }: Pick<PageProps<"/driver/jobs/[assignmentId]">, "params">) {
  const user = await requireDriver();
  const { assignmentId } = await params;
  // the same "not found" for an unknown id, someone else's truck or a cancelled one
  const job = await getDriverJob(assignmentId);
  if (!job) notFound();

  const [catalogue, events, uploads, tz] = await Promise.all([
    getDriverCatalogue(), getDriverJobEvents(job.assignment_id), listMyUploads(job.shipment_id, user.id),
    getOrgTimezone(user.organizationId),
  ]);
  const steps = driverSteps(catalogue, job.containers);
  const stage = jobStage(job.containers);
  const tel = telHref(job.ops_contact_phone);
  const containerOptions = job.containers.map((c) => ({ id: c.id, label: c.container_number }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader back={{ href: "/driver", label: "My jobs" }}
        title={<span className="font-mono">{job.shipment_reference}</span>}
        description={`${stage.label} · ${job.client_name}`} />

      <Section title="Delivery">
        <dl className="flex flex-col gap-3 text-sm">
          <div className="flex gap-2">
            <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <dt className="sr-only">Deliver to</dt>
              <dd className="break-words font-medium">{job.client_name}</dd>
              <dd className="break-words">{job.delivery_address || `${job.destination_city}, ${job.destination_country}`}</dd>
            </div>
          </div>
          {(job.route_name || job.border_crossing) && (
            <div className="flex gap-2">
              <Route className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <dt className="sr-only">Route</dt>
                <dd className="break-words">{job.route_name ?? "Route"}{job.border_crossing ? ` · border: ${job.border_crossing}` : ""}</dd>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Truck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <dt className="sr-only">Truck</dt>
              <dd>{job.truck_registration}{job.trailer_registration ? ` / ${job.trailer_registration}` : ""} · {job.transporter_name}</dd>
              {job.planned_loading_at && <dd className="text-muted-foreground">Loading planned {formatDateTime(job.planned_loading_at, tz)}</dd>}
            </div>
          </div>
          {job.cargo_description && (
            <div className="flex gap-2">
              <Package className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0"><dt className="sr-only">Cargo</dt><dd className="break-words">{job.cargo_description}</dd></div>
            </div>
          )}
        </dl>
        {job.ops_contact_name && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 p-3 text-sm">
            <span>NGB operations: <span className="font-medium">{job.ops_contact_name}</span></span>
            {tel && (
              <a href={tel} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-3 font-medium text-primary-foreground">
                <Phone className="size-4" aria-hidden /> Call
              </a>
            )}
          </div>
        )}
      </Section>

      <Section title="Containers">
        <ul className="flex flex-col gap-2">
          {job.containers.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
              <span className="font-mono font-semibold">{c.container_number}</span>
              <span className="flex flex-wrap items-center gap-2">
                <ShipmentStatusBadge status={c.operational_status} />
                {c.delivery_status !== "pending" && <span className="text-xs text-muted-foreground">{DELIVERY_STATUS_LABELS[c.delivery_status]}</span>}
              </span>
              {(c.size_type || c.seal_number) && (
                <span className="w-full text-xs text-muted-foreground">
                  {[c.size_type, c.seal_number && `seal ${c.seal_number}`].filter(Boolean).join(" · ")}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Update NGB and the client" id="update">
        {steps.length > 0 ? (
          <DriverStepForm assignmentId={job.assignment_id} steps={steps} containers={containerOptions}
            evidence={uploads.map((d) => ({ id: d.id, label: `${DOCUMENT_TYPE_LABELS[d.document_type]}: ${d.file_name}` }))} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {stage.tone === "waiting"
              ? "Road updates start after gate-out. NGB records loading and gate-out at the port."
              : stage.tone === "done" ? "All containers are delivered. Thank you." : "Nothing to record right now."}
          </p>
        )}
      </Section>

      <Section title="Photos and proof of delivery">
        <DocumentUploadForm shipmentId={job.shipment_id} types={DRIVER_UPLOAD_TYPES} containers={containerOptions}
          defaultType={stage.tone === "road" ? "proof_of_delivery" : "photo"} chooseVisibility={false} />
        <p className="mt-3 text-xs text-muted-foreground">NGB checks your files before the client can see them.</p>
        {uploads.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            {uploads.map((d) => (
              <li key={d.id} className="flex min-w-0 justify-between gap-2">
                <span className="truncate">{DOCUMENT_TYPE_LABELS[d.document_type]}: {d.file_name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(d.uploaded_at, tz)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Report a problem">
        <ReportProblemForm assignmentId={job.assignment_id} />
      </Section>

      <Section title="Your contact details">
        <ContactSharing assignmentId={job.assignment_id} shared={job.share_with_client} clientAllows={job.client_allows_contact} />
      </Section>

      <Section title="History">
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <ol className="flex flex-col gap-2 text-sm">
            {events.map((e) => (
              <li key={e.event_id} className="flex flex-col border-l-2 border-primary/30 pl-3">
                <span className="font-medium">{e.label}{e.recorded_by_me && <span className="font-normal text-muted-foreground"> · by you</span>}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(e.event_at, tz)} · <span className="font-mono">{e.container_number}</span>{e.location ? ` · ${e.location}` : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}
