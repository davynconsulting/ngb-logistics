import Link from "next/link";
import { Container, MapPin } from "lucide-react";
import type { PortalShipmentCard } from "@/lib/dal/portal";
import { formatDateTime } from "@/lib/format";
import { ShipmentStatusBadge } from "@/components/shipments/status-badge";
import { Journey } from "./journey";

/** A client's shipment: reference, status, route, ETA and progress. The whole card is the link. */
export function ShipmentCard({ s, timeZone }: { s: PortalShipmentCard; timeZone: string }) {
  const containers = s.containers?.[0]?.count ?? 0;
  return (
    <li className="relative flex flex-col gap-3 rounded-lg border bg-card p-4 transition-colors has-[a:hover]:border-primary/40">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/portal/shipments/${encodeURIComponent(s.shipment_reference)}`}
            className="font-mono text-sm font-semibold text-primary underline-offset-4 after:absolute after:inset-0 hover:underline">
            {s.shipment_reference}
          </Link>
          {s.bl_number && <p className="text-xs text-muted-foreground">BL {s.bl_number}</p>}
        </div>
        <ShipmentStatusBadge status={s.overall_status} />
      </div>
      {s.cargo_description && <p className="line-clamp-2 text-sm">{s.cargo_description}</p>}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <MapPin className="size-3.5" aria-hidden />
          {s.origin?.name ?? "Port"} → {s.destination_city}
        </span>
        <span className="inline-flex items-center gap-1">
          <Container className="size-3.5" aria-hidden />
          {containers} container{containers === 1 ? "" : "s"}
        </span>
      </p>
      <Journey status={s.overall_status} compact />
      <p className="text-sm">
        <span className="text-muted-foreground">ETA </span>
        <span className="font-medium">{s.current_eta ? formatDateTime(s.current_eta, timeZone) : "To be confirmed"}</span>
      </p>
    </li>
  );
}
