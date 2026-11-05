import { describe, expect, it } from "vitest";
import { Constants } from "@/lib/supabase/database.types";
import { canCorrect, groupBatches, milestoneOptions, toLocalInputValue, type CatalogueEntry } from "@/lib/domain/milestones";

const order = Constants.public.Enums.shipment_status;
const entry = (o: Partial<CatalogueEntry> & Pick<CatalogueEntry, "milestone_type" | "sort_order">): CatalogueEntry => ({
  label: o.milestone_type, scope: "container", allowed_roles: ["admin", "ops_manager"], client_visible_default: true,
  requires_location: false, requires_overall: null, requires_operational: null, requires_customs: null,
  sets_overall: null, sets_operational: null, sets_customs: null, sets_transport: null, sets_delivery: null, sets_return: null,
  ...o,
});
// a small slice of the real catalogue (migration 0010)
const catalogue = [
  entry({ milestone_type: "shipment_confirmed", sort_order: 10, scope: "shipment", requires_overall: ["draft"], sets_overall: "registered", allowed_roles: ["admin", "ops_manager", "doc_officer"] }),
  entry({ milestone_type: "container_discharged", sort_order: 30, requires_operational: ["vessel_arrived"], sets_operational: "container_discharged", allowed_roles: ["admin", "ops_manager", "clearing_agent"] }),
  entry({ milestone_type: "gate_out", sort_order: 90, requires_operational: ["loaded"], sets_operational: "in_transit", allowed_roles: ["admin", "ops_manager", "transport_coord"] }),
  entry({ milestone_type: "customs_released", sort_order: 240, scope: "shipment", requires_customs: ["submitted", "inspection", "duties_pending"], sets_customs: "released", allowed_roles: ["admin", "ops_manager", "clearing_agent"] }),
  entry({ milestone_type: "update", sort_order: 900, scope: "either", allowed_roles: ["admin", "ops_manager", "doc_officer", "clearing_agent", "transport_coord", "driver"] }),
];
const c = (id: string, operational_status: (typeof order)[number]) => ({ id, label: id, operational_status });

describe("milestoneOptions", () => {
  it("offers only the role's milestones", () => {
    const ship = { overall_status: "vessel_arrived" as const, customs_status: "not_started" as const };
    const types = (role: Parameters<typeof milestoneOptions>[1]) =>
      milestoneOptions(catalogue, role, ship, [c("a", "vessel_arrived")], order).map((o) => o.entry.milestone_type);
    expect(types("clearing_agent")).toEqual(["container_discharged", "customs_released", "update"]);
    expect(types("transport_coord")).toEqual(["gate_out", "update"]);
    expect(types("finance")).toEqual([]);
    expect(types("client")).toEqual([]);
  });

  it("a draft shipment only offers confirmation and updates", () => {
    const ship = { overall_status: "draft" as const, customs_status: "not_started" as const };
    expect(milestoneOptions(catalogue, "admin", ship, [c("a", "registered")], order).map((o) => o.entry.milestone_type))
      .toEqual(["shipment_confirmed", "update"]);
  });

  it("a closed shipment offers nothing", () => {
    expect(milestoneOptions(catalogue, "admin", { overall_status: "closed", customs_status: "released" }, [], order)).toEqual([]);
  });

  it("splits containers into eligible, past and not ready (AC-02)", () => {
    const ship = { overall_status: "vessel_arrived" as const, customs_status: "not_started" as const };
    const o = milestoneOptions(catalogue, "admin", ship,
      [c("a", "vessel_arrived"), c("b", "port_processing"), c("d", "registered")], order)
      .find((x) => x.entry.milestone_type === "container_discharged")!;
    expect(o.eligible).toEqual(["a"]);
    expect(o.past).toEqual(["b"]);
    expect(o.problems).toEqual([]);
  });

  it("gate-out needs customs released", () => {
    const ship = { overall_status: "loaded" as const, customs_status: "submitted" as const };
    const o = milestoneOptions(catalogue, "admin", ship, [c("a", "loaded")], order).find((x) => x.entry.milestone_type === "gate_out")!;
    expect(o.problems).toContain("customs is not released");
    const ok = milestoneOptions(catalogue, "admin", { ...ship, customs_status: "released" }, [c("a", "loaded")], order)
      .find((x) => x.entry.milestone_type === "gate_out")!;
    expect(ok.problems).toEqual([]);
    expect(ok.eligible).toEqual(["a"]);
  });

  it("customs steps follow the customs track", () => {
    const o = milestoneOptions(catalogue, "admin", { overall_status: "registered", customs_status: "not_started" }, [], order)
      .find((x) => x.entry.milestone_type === "customs_released")!;
    expect(o.problems).toEqual(["customs is not started"]);
  });
});

describe("canCorrect", () => {
  const now = Date.parse("2026-11-05T12:00:00Z");
  const ev = (by: string, hoursAgo: number) => ({ recorded_by: by, recorded_at: new Date(now - hoursAgo * 3600e3).toISOString() });
  it("ops manager and admin always", () => {
    expect(canCorrect("ops_manager", "x", ev("y", 100), now)).toBe(true);
    expect(canCorrect("admin", "x", ev("y", 100), now)).toBe(true);
  });
  it("the recorder within 24 hours only", () => {
    expect(canCorrect("clearing_agent", "me", ev("me", 23), now)).toBe(true);
    expect(canCorrect("clearing_agent", "me", ev("me", 25), now)).toBe(false);
    expect(canCorrect("transport_coord", "me", ev("other", 1), now)).toBe(false);
  });
  it("never finance or clients", () => {
    expect(canCorrect("finance", "me", ev("me", 1), now)).toBe(false);
    expect(canCorrect("client", "me", ev("me", 1), now)).toBe(false);
  });
});

describe("groupBatches", () => {
  it("groups by batch, newest event first", () => {
    const r = (id: string, batch_id: string, at: string) => ({ id, batch_id, container_id: null, event_at: at, recorded_at: at });
    const g = groupBatches([r("1", "A", "2026-11-01T10:00:00Z"), r("2", "B", "2026-11-03T10:00:00Z"), r("3", "A", "2026-11-01T10:00:00Z")]);
    expect(g.map((b) => [b.batchId, b.events.length])).toEqual([["B", 1], ["A", 2]]);
  });
});

describe("toLocalInputValue", () => {
  it("formats for datetime-local", () => {
    expect(toLocalInputValue(new Date(2026, 10, 5, 9, 7))).toBe("2026-11-05T09:07");
  });
});
