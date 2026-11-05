import { describe, expect, it } from "vitest";
import { areaOf, canUseArea, homePathFor, isAppRole, safeNextPath } from "@/lib/auth/roles";

describe("role routing", () => {
  it("sends clients to the portal, drivers to the driver pages and other staff to admin", () => {
    expect(homePathFor("client")).toBe("/portal");
    expect(homePathFor("driver")).toBe("/driver");
    for (const r of ["admin", "ops_manager", "doc_officer", "clearing_agent", "transport_coord", "finance"] as const) {
      expect(homePathFor(r)).toBe("/admin");
    }
  });

  it("classifies areas without prefix confusion", () => {
    expect(areaOf("/portal")).toBe("portal");
    expect(areaOf("/portal/shipments/1")).toBe("portal");
    expect(areaOf("/admin")).toBe("admin");
    expect(areaOf("/administrator")).toBeNull();
    expect(areaOf("/portals")).toBeNull();
    expect(areaOf("/login")).toBeNull();
    expect(areaOf("/driver")).toBe("driver");
    expect(areaOf("/driver/jobs/1")).toBe("driver");
    expect(areaOf("/drivers")).toBeNull();
  });

  it("keeps clients out of admin and staff out of the portal", () => {
    expect(canUseArea("client", "admin")).toBe(false);
    expect(canUseArea("client", "portal")).toBe(true);
    expect(canUseArea("finance", "portal")).toBe(false);
    expect(canUseArea("driver", "admin")).toBe(false);
    expect(canUseArea("driver", "driver")).toBe(true);
    expect(canUseArea("driver", "portal")).toBe(false);
    expect(canUseArea("admin", "driver")).toBe(false);
    expect(canUseArea("client", "driver")).toBe(false);
    expect(safeNextPath("/admin/shipments", "driver")).toBeNull();
    expect(safeNextPath("/driver/jobs/x", "driver")).toBe("/driver/jobs/x");
  });

  it("validates roles", () => {
    expect(isAppRole("finance")).toBe(true);
    expect(isAppRole("superuser")).toBe(false);
    expect(isAppRole(undefined)).toBe(false);
  });
});

describe("safeNextPath (post-login redirect)", () => {
  it("allows local paths in the user's own area", () => {
    expect(safeNextPath("/portal/shipments?tab=docs", "client")).toBe("/portal/shipments?tab=docs");
    expect(safeNextPath("/admin/shipments", "doc_officer")).toBe("/admin/shipments");
  });

  it("rejects paths in the other area", () => {
    expect(safeNextPath("/admin", "client")).toBeNull();
    expect(safeNextPath("/portal", "admin")).toBeNull();
  });

  it.each([
    "https://evil.example/portal",
    "//evil.example/portal",
    "/\\evil.example/portal",
    "javascript:alert(1)",
    "portal",
    "",
    undefined,
    null,
  ])("blocks open redirect %j", (next) => {
    expect(safeNextPath(next as string, "client")).toBeNull();
  });

  it("allows exact document links (the route checks access itself)", () => {
    const id = "37019b11-1111-4111-8111-111111111111";
    expect(safeNextPath(`/documents/${id}`, "client")).toBe(`/documents/${id}`);
    expect(safeNextPath(`/documents/${id}?download=1`, "finance")).toBe(`/documents/${id}?download=1`);
    expect(safeNextPath("/documents/not-an-id", "client")).toBeNull();
    expect(safeNextPath(`/documents/${id}/../../admin`, "client")).toBeNull();
  });

  it("rejects public pages as a next target", () => {
    expect(safeNextPath("/login", "client")).toBeNull();
    expect(safeNextPath("/", "client")).toBeNull();
  });
});
