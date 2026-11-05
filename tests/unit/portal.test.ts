import { describe, expect, it } from "vitest";
import { JOURNEY, inboxEntry, isActiveShipment, journeyStep, maskedPhone, normalizePhone, safePortalPath } from "@/lib/domain/portal";
import { SHIPMENT_STATUS_LABELS, type ShipmentStatus } from "@/lib/domain/status-labels";
import { CLIENT_UPLOAD_TYPES, uploadTypesFor } from "@/lib/domain/documents";

describe("client journey", () => {
  it("every shipment status maps to exactly one step", () => {
    for (const s of Object.keys(SHIPMENT_STATUS_LABELS) as ShipmentStatus[]) {
      expect(JOURNEY.filter((j) => j.statuses.includes(s))).toHaveLength(1);
    }
  });
  it("steps advance in order", () => {
    expect(journeyStep("registered")).toBe(0);
    expect(journeyStep("port_processing")).toBe(1);
    expect(journeyStep("in_transit")).toBe(2);
    expect(journeyStep("arrived")).toBe(3);
    expect(journeyStep("delivered")).toBe(4);
    expect(journeyStep("container_returned")).toBe(5);
  });
  it("completed shipments are not active", () => {
    expect(isActiveShipment("in_transit")).toBe(true);
    expect(isActiveShipment("operationally_complete")).toBe(false);
    expect(isActiveShipment("closed")).toBe(false);
  });
});

describe("WhatsApp number", () => {
  it.each([
    ["+250 788 123 456", "+250788123456"],
    ["00250788123456", "+250788123456"],
    ["(+254) 712-345-678", "+254712345678"],
    [" +255.754.123.456 ", "+255754123456"],
  ])("normalises %s", (input, out) => expect(normalizePhone(input)).toBe(out));
  it.each(["0788123456", "788123456", "+0788123456", "+25078812345678901", "phone", ""])("refuses %s", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
  it("masks for display", () => expect(maskedPhone("+250788123456")).toBe("+250788***456"));
});

describe("inbox", () => {
  it("uses the same texts as push, with a portal link", () => {
    const e = inboxEntry({ template_key: "eta.changed", shipment_id: null,
      payload: { reference: "NGB-2026-00012", previous_eta: "2026-11-13T08:00:00Z", new_eta: "2026-11-14T08:00:00Z", reason: "Border queue" } }, "Africa/Kigali");
    expect(e.title).toBe("NGB-2026-00012: new ETA");
    expect(e.body).toContain("Border queue");
    expect(e.url).toBe("/portal/shipments/NGB-2026-00012");
  });
  it("an unknown template still shows a generic entry", () => {
    expect(inboxEntry({ template_key: "invoice.paid", payload: {}, shipment_id: null }, "Africa/Kigali")).toMatchObject({ url: "/portal" });
  });
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"])("never links outside the app (%s)", (u) => {
    expect(safePortalPath(u)).toBe("/portal");
  });
});

describe("client uploads", () => {
  it("clients upload only the commercial documents", () => {
    expect(uploadTypesFor("client")).toEqual(CLIENT_UPLOAD_TYPES);
    expect(CLIENT_UPLOAD_TYPES).not.toContain("customs_entry");
    expect(CLIENT_UPLOAD_TYPES).not.toContain("proof_of_delivery");
  });
});
