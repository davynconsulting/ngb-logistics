import type { Database } from "@/lib/supabase/database.types";

type Enums = Database["public"]["Enums"];
export type ShipmentStatus = Enums["shipment_status"];

/** Client-friendly wording for the overall shipment status (FRS §4.1). */
export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  draft: "Draft",
  registered: "Registered",
  awaiting_documents: "Awaiting documents",
  vessel_arrived: "Vessel arrived",
  container_discharged: "Container discharged",
  port_processing: "Port processing",
  ready_for_dispatch: "Ready for dispatch",
  truck_assigned: "Truck assigned",
  loading: "Loading",
  loaded: "Loaded",
  in_transit: "In transit",
  arrived: "Arrived at destination",
  delivered: "Delivered",
  container_returned: "Container returned",
  operationally_complete: "Operationally complete",
  closed: "Closed",
};

export type StatusTone = "neutral" | "info" | "progress" | "success" | "warning";

export function shipmentStatusTone(status: ShipmentStatus): StatusTone {
  switch (status) {
    case "draft":
    case "registered":
      return "neutral";
    case "awaiting_documents":
      return "warning";
    case "delivered":
    case "container_returned":
    case "operationally_complete":
    case "closed":
      return "success";
    case "in_transit":
    case "arrived":
      return "progress";
    default:
      return "info";
  }
}
