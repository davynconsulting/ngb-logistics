import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DOC_LABELS, renderNotification } from "@/supabase/functions/_shared/notify/templates.ts";
import { DOCUMENT_TYPE_LABELS } from "@/lib/domain/documents";

/** Every template key the migrations create, so a new rule without a text fails here. */
const ruleKeys = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(`supabase/migrations/${f}`, "utf8"))
  .flatMap((sql) => [...sql.matchAll(/^\s*\('([a-z_]+\.[a-z_]+)',\s*'(client|staff)'/gm)].map((m) => m[1]));

const sample = {
  shipment_id: "0b0e9f5e-5f4b-4b8e-9d55-1f2a3b4c5d6e", reference: "NGB-2026-00012", bl_number: "MEDUAK123456",
  origin: "Dar es Salaam", destination: "Kigali, Rwanda", current_eta: "2026-11-14T08:00:00Z", timezone: "Africa/Kigali",
  label: "Gate-out confirmed", event_at: "2026-11-12T12:30:00Z", location: "TICTS Terminal 2",
  containers: ["MSKU1234565", "TGHU7654321"], previous_eta: "2026-11-13T08:00:00Z", new_eta: "2026-11-14T08:00:00Z",
  reason: "Border queue at Rusumo", document_type: "commercial_invoice", message: "Customs asked a question; we answer today.",
  title: "Port processing over SLA", severity: "high", next_action: "Call the terminal", organization: "Akagera Traders Ltd (fictional)",
  file_name: "Packing list.pdf", exception_id: "1e2d3c4b-0000-4000-8000-000000000001",
};

describe("notification templates", () => {
  it("found the rules in the migrations", () => {
    expect(ruleKeys.length).toBeGreaterThanOrEqual(31);
    expect(ruleKeys).toContain("milestone.gate_out");
    expect(ruleKeys).toContain("staff.client_uploaded");
  });

  it.each(ruleKeys)("renders %s", (key) => {
    const r = renderNotification({ template_key: key, payload: sample, shipment_id: sample.shipment_id, timezone: "Africa/Kigali" });
    expect(r.title.length).toBeGreaterThan(3);
    expect(r.body.length).toBeGreaterThan(3);
    expect(`${r.title} ${r.body}`).not.toMatch(/undefined|null|\[object/);
    expect(r.url).toMatch(/^\/(portal|admin)/);
    expect(r.whatsapp.template).toMatch(/^ngb_[a-z_]+$/);
  });

  it("client links go to the portal by reference, staff links to the admin shipment", () => {
    expect(renderNotification({ template_key: "eta.changed", payload: sample }).url).toBe("/portal/shipments/NGB-2026-00012");
    expect(renderNotification({ template_key: "staff.exception_opened", payload: sample }).url).toBe(`/admin/shipments/${sample.shipment_id}`);
  });

  it("driver reports go to the shipment's staff page with the driver's words", () => {
    const r = renderNotification({ template_key: "staff.driver_report", payload: { ...sample, truck: "RAD 123 B", message: "Flat tyre near Kayonza" } });
    expect(r.title).toBe("NGB-2026-00012: driver report");
    expect(r.body).toBe("Truck RAD 123 B: Flat tyre near Kayonza");
    expect(r.url).toBe(`/admin/shipments/${sample.shipment_id}`);
  });

  it("formats times in the client's time zone", () => {
    const kgl = renderNotification({ template_key: "milestone.gate_out", payload: sample, timezone: "Africa/Kigali" });
    expect(kgl.body).toContain("12 Nov, 14:30"); // 12:30 UTC = 14:30 CAT
    const dar = renderNotification({ template_key: "milestone.gate_out", payload: sample, timezone: "Africa/Dar_es_Salaam" });
    expect(dar.body).toContain("12 Nov, 15:30");
  });

  it("milestone text: containers, location, route and ETA", () => {
    const r = renderNotification({ template_key: "milestone.gate_out", payload: { ...sample, route: "Dar es Salaam → Kigali" } });
    expect(r.title).toBe("NGB-2026-00012: Gate-out confirmed");
    expect(r.body).toContain("for MSKU1234565 and TGHU7654321 at TICTS Terminal 2");
    expect(r.body).toContain("Route: Dar es Salaam → Kigali.");
    expect(r.body).toContain("ETA 14 Nov, 10:00");
    const many = renderNotification({ template_key: "milestone.loaded", payload: { ...sample, containers: ["A", "B", "C"] } });
    expect(many.body).toContain("for 3 containers");
  });

  it("shipment confirmed lists the documents still needed", () => {
    const r = renderNotification({ template_key: "milestone.shipment_confirmed", payload: { ...sample, label: "Shipment confirmed", missing_documents: ["bill_of_lading", "packing_list"] } });
    expect(r.body).toContain("Documents still needed: Bill of lading, Packing list.");
    const done = renderNotification({ template_key: "milestone.shipment_confirmed", payload: { ...sample, missing_documents: [] } });
    expect(done.body).toContain("All required documents received.");
  });

  it("ETA change and rejected document", () => {
    expect(renderNotification({ template_key: "eta.changed", payload: sample }).body)
      .toBe("ETA changed from 13 Nov, 10:00 to 14 Nov, 10:00. Reason: Border queue at Rusumo");
    expect(renderNotification({ template_key: "document.rejected", payload: { ...sample, reason: "Amount does not match", due_date: "2026-11-20" } }).body)
      .toBe("Commercial invoice was not accepted: Amount does not match. Please upload a corrected copy by 2026-11-20.");
  });

  it("long notes are clipped", () => {
    const r = renderNotification({ template_key: "milestone.update", payload: { ...sample, label: "Update", note: "x".repeat(1000) } });
    expect(r.body.length).toBeLessThanOrEqual(700);
    expect(r.body).toContain("…");
  });

  it("unknown templates throw", () => {
    expect(() => renderNotification({ template_key: "invoice.paid", payload: {} })).toThrow(/No template/);
  });

  it("document labels match the app's labels", () => {
    expect(DOC_LABELS).toEqual(DOCUMENT_TYPE_LABELS);
  });
});
