import type { DocumentType } from "@/lib/domain/documents";
import type { CatalogueEntry, DeliveryStatus, MilestoneType } from "@/lib/domain/milestones";
import type { ShipmentStatus } from "@/lib/domain/status-labels";

/**
 * Driver pages: what a driver can do on the road. The database is the
 * authority (milestone catalogue roles, 0020 own-truck rule); these helpers
 * only decide which buttons to show.
 */

/** Road milestones a driver records, in the order they happen. */
export const DRIVER_STEPS: readonly MilestoneType[] = [
  "transit_checkpoint", "arrived_at_border", "border_crossed", "arrived", "offloading_started", "delivered",
];

/** Short button texts for the phone. */
export const DRIVER_STEP_LABELS: Partial<Record<MilestoneType, string>> = {
  transit_checkpoint: "Checkpoint passed",
  arrived_at_border: "At the border",
  border_crossed: "Border crossed",
  arrived: "Arrived at destination",
  offloading_started: "Offloading started",
  delivered: "Delivered",
};

/** What drivers upload from the road (photos, POD, papers). Same set as the documents_insert policy. */
export const DRIVER_UPLOAD_TYPES: DocumentType[] = [
  "proof_of_delivery", "photo", "transit_document", "gate_pass", "container_return_receipt", "other",
];

export type DriverContainer = {
  id: string;
  container_number: string;
  size_type: string | null;
  seal_number: string | null;
  operational_status: ShipmentStatus;
  delivery_status: DeliveryStatus;
};

export type DriverStep = {
  type: MilestoneType;
  label: string;
  requiresLocation: boolean;
  /** Containers on this truck that can take the step now. */
  eligible: string[];
};

/** The road steps available now for the containers on the driver's truck. */
export function driverSteps(catalogue: readonly CatalogueEntry[], containers: readonly DriverContainer[]): DriverStep[] {
  const steps: DriverStep[] = [];
  for (const type of DRIVER_STEPS) {
    const entry = catalogue.find((c) => c.milestone_type === type);
    if (!entry || !entry.allowed_roles.includes("driver")) continue;
    const eligible = containers
      .filter((c) => !entry.requires_operational || entry.requires_operational.includes(c.operational_status))
      // offloading is reported once per container
      .filter((c) => type !== "offloading_started" || c.delivery_status === "pending")
      .map((c) => c.id);
    if (eligible.length) {
      steps.push({ type, label: DRIVER_STEP_LABELS[type] ?? entry.label, requiresLocation: entry.requires_location, eligible });
    }
  }
  return steps;
}

const BEFORE_ROAD: readonly ShipmentStatus[] = ["truck_assigned", "loading", "loaded"];
const AFTER_DELIVERY: readonly ShipmentStatus[] = ["delivered", "container_returned", "operationally_complete", "closed"];

/** One line for the job card. */
export function jobStage(containers: readonly DriverContainer[]): { label: string; tone: "waiting" | "road" | "done" } {
  if (containers.length && containers.every((c) => AFTER_DELIVERY.includes(c.operational_status))) {
    return { label: "Delivered", tone: "done" };
  }
  if (containers.some((c) => c.operational_status === "arrived")) return { label: "At destination", tone: "road" };
  if (containers.some((c) => c.operational_status === "in_transit")) return { label: "On the road", tone: "road" };
  if (containers.every((c) => BEFORE_ROAD.includes(c.operational_status))) return { label: "Waiting for loading and gate-out", tone: "waiting" };
  return { label: "In progress", tone: "road" };
}

/** tel: link for a stored E.164 number, or null. */
export function telHref(phone: string | null | undefined): string | null {
  return phone && /^\+[1-9][0-9]{6,14}$/.test(phone) ? `tel:${phone}` : null;
}
