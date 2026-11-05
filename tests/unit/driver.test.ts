import { describe, expect, it } from "vitest";
import { DRIVER_STEPS, DRIVER_UPLOAD_TYPES, driverSteps, jobStage, telHref, type DriverContainer } from "@/lib/domain/driver";
import { uploadTypesFor } from "@/lib/domain/documents";
import type { CatalogueEntry } from "@/lib/domain/milestones";

// The road part of the milestone catalogue (0010), as the database has it
const entry = (milestone_type: string, requires_operational: string[] | null, roles: string[], requires_location = false) =>
  ({ milestone_type, label: milestone_type, allowed_roles: roles, requires_operational, requires_location } as unknown as CatalogueEntry);
const ROAD = ["admin", "ops_manager", "transport_coord", "driver"];
const catalogue = [
  entry("gate_out", ["loaded"], ["admin", "ops_manager", "transport_coord"], true),
  entry("transit_checkpoint", ["in_transit"], ROAD, true),
  entry("arrived_at_border", ["in_transit"], ROAD, true),
  entry("border_crossed", ["in_transit"], ROAD, true),
  entry("arrived", ["in_transit"], ROAD),
  entry("offloading_started", ["arrived"], ROAD),
  entry("delivered", ["arrived"], ROAD),
];
const box = (id: string, operational_status: string, delivery_status = "pending") =>
  ({ id, container_number: id, size_type: "40HC", seal_number: null, operational_status, delivery_status } as DriverContainer);

describe("driver steps", () => {
  it("offers only road steps the driver role may record", () => {
    const steps = driverSteps(catalogue, [box("A", "in_transit")]);
    expect(steps.map((s) => s.type)).toEqual(["transit_checkpoint", "arrived_at_border", "border_crossed", "arrived"]);
    expect(steps.every((s) => DRIVER_STEPS.includes(s.type))).toBe(true);
    expect(steps[0].requiresLocation).toBe(true);
  });
  it("nothing before gate-out (NGB records loading and gate-out)", () => {
    expect(driverSteps(catalogue, [box("A", "loaded")])).toEqual([]);
  });
  it("each step lists the containers that can take it now", () => {
    const steps = driverSteps(catalogue, [box("A", "in_transit"), box("B", "arrived")]);
    expect(steps.find((s) => s.type === "arrived")?.eligible).toEqual(["A"]);
    expect(steps.find((s) => s.type === "delivered")?.eligible).toEqual(["B"]);
  });
  it("offloading is reported once", () => {
    const steps = driverSteps(catalogue, [box("B", "arrived", "offloading")]);
    expect(steps.map((s) => s.type)).toEqual(["delivered"]);
  });
});

describe("job stage", () => {
  it("summarises the truck", () => {
    expect(jobStage([box("A", "truck_assigned")]).tone).toBe("waiting");
    expect(jobStage([box("A", "in_transit")]).label).toBe("On the road");
    expect(jobStage([box("A", "arrived"), box("B", "in_transit")]).label).toBe("At destination");
    expect(jobStage([box("A", "delivered"), box("B", "container_returned")]).tone).toBe("done");
  });
});

describe("driver uploads and contact", () => {
  it("upload choices stay within what the database lets drivers upload", () => {
    const allowed = uploadTypesFor("driver");
    expect(DRIVER_UPLOAD_TYPES.every((t) => allowed.includes(t))).toBe(true);
    expect(DRIVER_UPLOAD_TYPES).not.toContain("customs_entry");
    expect(DRIVER_UPLOAD_TYPES).not.toContain("commercial_invoice");
  });
  it("tel: links only for stored international numbers", () => {
    expect(telHref("+250788000111")).toBe("tel:+250788000111");
    expect(telHref("0788 000 111")).toBeNull();
    expect(telHref("javascript:alert(1)")).toBeNull();
    expect(telHref(null)).toBeNull();
  });
});
