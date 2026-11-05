import { describe, expect, it } from "vitest";
import {
  canAssignTransport, canManageExceptions, canReviseEta, canRunSlaCheck, etaEditable, formatChange,
  parseQueueFilter, sortQueue, transportCandidates,
} from "@/lib/domain/operations";
import { assignTransportSchema, exceptionActionSchema, reviseEtaSchema } from "@/lib/validation/operations";

describe("role checks mirror the database functions", () => {
  it("ETA", () => {
    expect(canReviseEta("transport_coord")).toBe(true);
    expect(canReviseEta("clearing_agent")).toBe(true);
    expect(canReviseEta("finance")).toBe(false);
    expect(canReviseEta("driver")).toBe(false);
    expect(canReviseEta("client")).toBe(false);
  });
  it("transport, exceptions, SLA check", () => {
    expect(canAssignTransport("transport_coord")).toBe(true);
    expect(canAssignTransport("clearing_agent")).toBe(false);
    expect(canManageExceptions("finance")).toBe(true);
    expect(canManageExceptions("driver")).toBe(false);
    expect(canRunSlaCheck("ops_manager")).toBe(true);
    expect(canRunSlaCheck("transport_coord")).toBe(false);
  });
  it("no ETA changes after delivery", () => {
    expect(etaEditable("in_transit")).toBe(true);
    expect(etaEditable("delivered")).toBe(false);
    expect(etaEditable("closed")).toBe(false);
  });
});

describe("formatChange", () => {
  it("formats signed durations", () => {
    expect(formatChange(null)).toBe("First ETA");
    expect(formatChange(200)).toBe("+3 h 20 min");
    expect(formatChange(-45)).toBe("−45 min");
    expect(formatChange(1440 + 60)).toBe("+1 d 1 h");
  });
});

describe("transportCandidates", () => {
  it("excludes gated-out containers and those with a truck; flags early ones", () => {
    const r = transportCandidates([
      { id: "a", operational_status: "ready_for_dispatch" },
      { id: "b", operational_status: "port_processing" },
      { id: "c", operational_status: "in_transit" },
      { id: "d", operational_status: "loaded" },
      { id: "e", operational_status: "truck_assigned" },
    ], new Set(["e"]));
    expect(r.map((c) => [c.id, c.needsOverride])).toEqual([["a", false], ["b", true], ["d", false]]);
  });
});

describe("exception queue", () => {
  it("escalated first, then severity, then follow-up", () => {
    const x = (id: string, o: Partial<{ escalated_at: string | null; severity: "low" | "medium" | "high" | "critical"; next_follow_up_at: string | null }>) =>
      ({ id, escalated_at: null, severity: "medium" as const, next_follow_up_at: null, opened_at: "2026-11-01T00:00:00Z", ...o });
    const order = sortQueue([
      x("low", { severity: "low" }),
      x("crit", { severity: "critical" }),
      x("esc", { escalated_at: "2026-11-02T00:00:00Z", severity: "low" }),
      x("medSoon", { next_follow_up_at: "2026-11-03T00:00:00Z" }),
      x("medLater", { next_follow_up_at: "2026-11-09T00:00:00Z" }),
    ]).map((r) => r.id);
    expect(order).toEqual(["esc", "crit", "medSoon", "medLater", "low"]);
  });
  it("unknown filters fall back to all open", () => {
    expect(parseQueueFilter("escalated")).toBe("escalated");
    expect(parseQueueFilter("drop table")).toBe("open");
  });
});

describe("validation", () => {
  it("ETA needs a reason", () => {
    expect(reviseEtaSchema.safeParse({ newEta: "2026-11-08T10:00:00.000Z", category: "border_delay", reason: "", clientVisible: true }).success).toBe(false);
    expect(reviseEtaSchema.safeParse({ newEta: "2026-11-08T10:00:00.000Z", category: "border_delay", reason: "Queue at Rusumo", clientVisible: true }).success).toBe(true);
  });
  it("transport: registrations normalised, refs split, driver name needed with phone", () => {
    const base = { containerIds: ["6f1c7a52-6a4f-4c3e-9a51-0d5b8f2f1a11"], transporter: "Kagera Haulage", truck: " t 123  abc ", transitRefs: "T1-1, T1-2 ,", trailer: "", driverName: "", driverPhone: "", driverUserId: "", routeId: "", plannedLoadingAt: "", overrideReason: "" };
    const ok = assignTransportSchema.safeParse(base);
    expect(ok.success && ok.data.truck).toBe("T 123 ABC");
    expect(ok.success && ok.data.transitRefs).toEqual(["T1-1", "T1-2"]);
    expect(assignTransportSchema.safeParse({ ...base, truck: "<b>" }).success).toBe(false);
    const noName = assignTransportSchema.safeParse({ ...base, driverPhone: "+250 788 000 111" });
    expect(noName.success).toBe(false);
    expect(assignTransportSchema.safeParse({ ...base, driverPhone: "+250 788 000 111", driverName: "Eric" }).success).toBe(true);
  });
  it("resolve needs a resolution", () => {
    expect(exceptionActionSchema.safeParse({ op: "resolve", resolution: "" }).success).toBe(false);
    expect(exceptionActionSchema.safeParse({ op: "resolve", resolution: "Released" }).success).toBe(true);
  });
});
