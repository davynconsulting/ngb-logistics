import Link from "next/link";
import { Container, MapPin } from "lucide-react";
import { ShipmentStatusBadge } from "./status-badge";
import { formatDate } from "@/lib/format";
import type { ShipmentListItem } from "@/lib/dal/shipments";

/** Mobile-first shipment cards (one column on phones, two on wider screens). */
export function ShipmentList({
  shipments, showClient = false, linkBase,
}: { shipments: ShipmentListItem[]; showClient?: boolean; linkBase?: string }) {
  if (shipments.length === 0) {
    return <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">No shipments yet.</p>;
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {shipments.map((s) => (
        <li key={s.id} className="relative flex flex-col gap-2 rounded-lg border bg-card p-4 transition-colors has-[a:hover]:border-primary/40">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              {linkBase ? (
                <Link href={`${linkBase}/${s.id}`} className="font-mono text-sm font-semibold text-primary underline-offset-4 after:absolute after:inset-0 hover:underline">
                  {s.shipment_reference}
                </Link>
              ) : (
                <p className="font-mono text-sm font-semibold">{s.shipment_reference}</p>
              )}
              {showClient && <p className="truncate text-xs text-muted-foreground">{s.client?.legal_name}</p>}
            </div>
            <ShipmentStatusBadge status={s.overall_status} exception={s.has_open_exception} />
          </div>
          <p className="line-clamp-2 text-sm">{s.cargo_description ?? "Cargo details pending"}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" aria-hidden />
              {s.origin?.name} → {s.destination_city}
            </span>
            <span className="inline-flex items-center gap-1">
              <Container className="size-3.5" aria-hidden />
              {s.containers[0]?.count ?? 0} container{(s.containers[0]?.count ?? 0) === 1 ? "" : "s"}
            </span>
            <span>Vessel ETA {formatDate(s.planned_vessel_arrival)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ShipmentListSkeleton() {
  return (
    <ul className="grid gap-3 md:grid-cols-2" aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <li key={i} className="h-32 animate-pulse rounded-lg border bg-muted/50" />
      ))}
    </ul>
  );
}
