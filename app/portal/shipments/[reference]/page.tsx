import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AlertTriangle, Phone, Truck } from "lucide-react";
import { requireClient } from "@/lib/dal/session";
import { getClientShipment, type ClientShipment } from "@/lib/dal/portal";
import { SHIPMENT_STATUS_LABELS } from "@/lib/domain/status-labels";
import {
  CUSTOMS_STATUS_LABELS, DELIVERY_STATUS_LABELS, LOCATION_KIND_LABELS, RETURN_STATUS_LABELS,
} from "@/lib/domain/milestones";
import { formatDate, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { ShipmentStatusBadge } from "@/components/shipments/status-badge";
import { Journey } from "@/components/portal/journey";
import { ClientDocuments } from "@/components/portal/client-documents";
import { InvoiceCard } from "@/components/portal/invoice-card";
import { listClientInvoices } from "@/lib/dal/client-finance";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Shipment" };

export default function ClientShipmentPage({ params }: PageProps<"/portal/shipments/[reference]">) {
  return (
    <Suspense fallback={<div className="flex flex-col gap-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-40 w-full" /></div>}>
      <Shipment params={params} />
    </Suspense>
  );
}

function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 rounded-lg border bg-card p-4">
      <h2 className="mb-3 text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}

async function Shipment({ params }: Pick<PageProps<"/portal/shipments/[reference]">, "params">) {
  await requireClient();
  const { reference } = await params;
  const ref = decodeURIComponent(reference);
  // Same "not found" for a reference that doesn't exist and one that belongs to another client (AC-05)
  const s = /^[A-Z0-9-]{3,40}$/i.test(ref) ? await getClientShipment(ref) : null;
  if (!s) notFound();
  const tz = s.client?.timezone ?? "Africa/Kigali";
  const invoices = (await listClientInvoices()).filter((i) => i.shipment_reference === s.shipment_reference);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader back={{ href: "/portal/shipments", label: "Shipments" }}
        title={<span className="font-mono">{s.shipment_reference}</span>}
        description={[s.bl_number && `BL ${s.bl_number}`, `${s.origin?.name ?? "Port"} → ${s.destination_city}, ${s.destination_country}`].filter(Boolean).join(" · ")}
        actions={<ShipmentStatusBadge status={s.overall_status} />} />

      <div className="-mt-3 rounded-lg border bg-card p-4">
        <Journey status={s.overall_status} />
      </div>

      {s.alerts.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Alerts">
          {s.alerts.map((a) => (
            <li key={a.alert_id} className="flex gap-3 rounded-lg border border-warning/60 bg-warning/10 p-4 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground dark:text-warning" aria-hidden />
              <span className="min-w-0 break-words">
                {a.message}
                {a.container_number && <span className="font-mono text-muted-foreground"> · {a.container_number}</span>}
                <span className="block text-xs text-muted-foreground">{formatDateTime(a.opened_at, tz)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <EtaSection s={s} tz={tz} />
        <Section title="Containers">
          <ul className="flex flex-col gap-3">
            {s.containers.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-semibold">{c.container_number}</span>
                  <ShipmentStatusBadge status={c.operational_status} />
                </div>
                <p className="text-muted-foreground">
                  {[c.size_type, c.location_name && `${c.location_kind ? `${LOCATION_KIND_LABELS[c.location_kind]}: ` : ""}${c.location_name}`,
                    c.seal_number && `Seal ${c.seal_number}`].filter(Boolean).join(" · ")}
                </p>
                <p className="text-xs text-muted-foreground">
                  Delivery: {DELIVERY_STATUS_LABELS[c.delivery_status]}{c.delivery_at && ` (${formatDate(c.delivery_at, tz)})`}
                  {" · "}Empty return: {RETURN_STATUS_LABELS[c.return_status]}{c.empty_return_at && ` (${formatDate(c.empty_return_at, tz)})`}
                </p>
                {c.return_status !== "returned" && (c.return_deadline || c.return_depot) && (
                  <p className={`text-xs ${c.return_status === "return_overdue" ? "font-medium text-destructive" : ""}`}>
                    Return the empty container{c.return_depot && ` to ${c.return_depot}`}{c.return_deadline && ` by ${formatDateTime(c.return_deadline, tz)}`}
                    {c.return_charges_note && <span className="block break-words text-muted-foreground">Charges: {c.return_charges_note}</span>}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Timeline">
          {s.timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">No updates yet.</p>
          ) : (
            <ol className="relative flex flex-col gap-4 border-l pl-4">
              {s.timeline.map((e) => (
                <li key={`${e.batch_id}-${e.milestone_type}`} className="relative text-sm">
                  <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-background bg-primary" aria-hidden />
                  <p className="font-medium">{e.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(e.event_at, tz)}{e.location && ` · ${e.location}`}{e.is_corrected && " · corrected"}
                  </p>
                  {e.containers?.length > 0 && <p className="font-mono text-xs text-muted-foreground">{e.containers.join(", ")}</p>}
                  {e.public_note && <p className="mt-1 break-words">{e.public_note}</p>}
                </li>
              ))}
            </ol>
          )}
        </Section>
        <TransportSection s={s} tz={tz} />
      </div>

      <Section title="Documents" id="documents">
        <ClientDocuments s={s} timeZone={tz} canUpload={!["operationally_complete", "closed"].includes(s.overall_status)} />
      </Section>

      {invoices.length > 0 && (
        <Section title="Invoices">
          <ul className="-mx-4 -my-2 flex flex-col divide-y sm:-mx-6">{invoices.map((i) => <InvoiceCard key={i.invoice_number} i={i} />)}</ul>
        </Section>
      )}

      <Section title="Details">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {([
            ["Status", SHIPMENT_STATUS_LABELS[s.overall_status]],
            ["Customs", CUSTOMS_STATUS_LABELS[s.customs_status]],
            ["Cargo", s.cargo_description],
            ["Packages", s.package_count],
            ["Gross weight", s.gross_weight_kg != null ? `${s.gross_weight_kg} kg` : null],
            ["Shipping line", s.shipping_line],
            ["Vessel / voyage", [s.vessel_name, s.voyage_number].filter(Boolean).join(" / ") || null],
            ["Vessel arrival", s.actual_vessel_arrival ? `${formatDate(s.actual_vessel_arrival, tz)} (actual)` : s.planned_vessel_arrival ? `${formatDate(s.planned_vessel_arrival, tz)} (planned)` : null],
            ["Booking reference", s.booking_reference],
            ["Delivery address", s.delivery_address],
          ] as [string, string | number | null][]).filter(([, v]) => v != null && v !== "").map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="text-sm break-words">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}

function EtaSection({ s, tz }: { s: ClientShipment; tz: string }) {
  const [latest, ...earlier] = s.etaHistory;
  return (
    <Section title="Estimated arrival">
      <p className="text-2xl font-semibold">{s.current_eta ? formatDateTime(s.current_eta, tz) : "To be confirmed"}</p>
      {s.eta_reason && <p className="mt-1 text-sm break-words text-muted-foreground">{latest?.reason ?? s.eta_reason}</p>}
      {s.eta_updated_at && <p className="text-xs text-muted-foreground">Updated {formatDateTime(s.eta_updated_at, tz)}</p>}
      {earlier.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground">Earlier estimates ({earlier.length})</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {earlier.map((r) => (
              <li key={r.id} className="break-words">
                <span className="font-medium">{formatDateTime(r.new_eta, tz)}</span>
                <span className="text-muted-foreground"> · {r.reason} · set {formatDate(r.revised_at, tz)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}

function TransportSection({ s, tz }: { s: ClientShipment; tz: string }) {
  return (
    <Section title="Road transport">
      {s.transport.length === 0 ? (
        <p className="text-sm text-muted-foreground">No truck assigned yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {s.transport.map((t) => (
            <li key={t.assignment_id} className="flex flex-col gap-1 rounded-md border p-3 text-sm">
              <p className="flex items-center gap-2 font-medium">
                <Truck className="size-4 text-muted-foreground" aria-hidden />
                <span className="font-mono">{t.truck_registration}</span>
                {t.trailer_registration && <span className="font-mono text-muted-foreground">/ {t.trailer_registration}</span>}
              </p>
              <p className="text-muted-foreground">
                {[t.transporter_name, t.route_name, t.border_crossing && `via ${t.border_crossing}`].filter(Boolean).join(" · ")}
              </p>
              {t.containers?.length > 0 && <p className="font-mono text-xs text-muted-foreground">{t.containers.join(", ")}</p>}
              <p className="text-xs text-muted-foreground">
                {t.actual_loading_at ? `Loaded ${formatDateTime(t.actual_loading_at, tz)}` : t.planned_loading_at ? `Loading planned ${formatDateTime(t.planned_loading_at, tz)}` : null}
              </p>
              {t.driver_name && (
                <p className="flex flex-wrap items-center gap-2">
                  Driver: {t.driver_name}
                  {t.driver_phone && (
                    <a href={`tel:${t.driver_phone}`} className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
                      <Phone className="size-3.5" aria-hidden />{t.driver_phone}
                    </a>
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
