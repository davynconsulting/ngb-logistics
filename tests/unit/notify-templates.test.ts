import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DOC_LABELS, formatDay, formatMoneyText, renderNotification } from "@/supabase/functions/_shared/notify/templates.ts";
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

  it("invoice issued: number, amount, due date and payment instructions; links to the portal invoice", () => {
    const r = renderNotification({ template_key: "invoice.issued", payload: { ...sample, invoice_number: "INV-2026-00007",
      total: "2878.49", balance_due: "2878.49", currency: "USD", due_date: "2026-12-05",
      payment_instructions: "Bank of Kigali (fictional), account 000-111-222" } });
    expect(r.title).toBe("Invoice INV-2026-00007");
    expect(r.body).toBe("NGB-2026-00012: invoice for 2,878.49 USD, due 5 Dec 2026. How to pay: Bank of Kigali (fictional), account 000-111-222");
    expect(r.url).toBe("/portal/invoices/INV-2026-00007");
  });

  it("payment verified: amount, reference, remaining balance and the receipt link", () => {
    const base = { ...sample, invoice_number: "INV-2026-00007", currency: "RWF", amount: "1500000.00", transaction_reference: "MM-889", receipt_number: "RCPT-2026-00003" };
    const r = renderNotification({ template_key: "payment.verified", payload: { ...base, balance_due: "250000.50" } });
    expect(r.title).toBe("INV-2026-00007: payment received");
    expect(r.body).toBe("We received 1,500,000.00 RWF (ref MM-889). Remaining balance: 250,000.50 RWF. Receipt RCPT-2026-00003.");
    expect(r.url).toBe("/portal/receipts/RCPT-2026-00003");
    expect(renderNotification({ template_key: "payment.verified", payload: { ...base, balance_due: "0.00" } }).body).toContain("paid in full");
  });

  it("payment reminders: due soon, due today, overdue", () => {
    const base = { ...sample, invoice_number: "INV-2026-00007", currency: "USD", balance_due: "1878.49", due_date: "2026-12-05" };
    const at = (days_from_due: number) => renderNotification({ template_key: "invoice.reminder", payload: { ...base, days_from_due } });
    expect(at(-3).title).toBe("INV-2026-00007: payment due soon");
    expect(at(-3).body).toBe("1,878.49 USD is due 5 Dec 2026 (in 3 days).");
    expect(at(0).body).toBe("1,878.49 USD is due today.");
    expect(at(7).title).toBe("INV-2026-00007: payment overdue");
    expect(at(1).body).toBe("1,878.49 USD was due 5 Dec 2026 (1 day ago). Please pay or contact NGB finance if you have a question.");
    expect(at(7).url).toBe("/portal/invoices/INV-2026-00007");
  });

  it("finance alerts link to the admin invoice", () => {
    const p = { ...sample, invoice_number: "INV-2026-00007", invoice_id: sample.exception_id, client_name: "Akagera Traders (fictional)",
      currency: "RWF", balance_due: "118000.00", due_date: "2026-11-01", reason: "Client queries the rate" };
    const o = renderNotification({ template_key: "staff.invoice_overdue", payload: p });
    expect(o.title).toBe("Overdue: INV-2026-00007");
    expect(o.body).toBe("Akagera Traders (fictional) · balance 118,000.00 RWF · due 1 Nov 2026");
    expect(o.url).toBe(`/admin/finance/invoices/${sample.exception_id}`);
    expect(renderNotification({ template_key: "staff.invoice_disputed", payload: p }).body).toContain("Client queries the rate");
  });

  it("shipment closed: summary and the next-booking contact", () => {
    const r = renderNotification({ template_key: "shipment.closed", payload: { ...sample, containers: 2, delivered_at: "2026-11-12T12:30:00Z",
      booking_contact: "bookings@ngb-logistics.example (fictional)" } });
    expect(r.title).toBe("NGB-2026-00012: shipment closed");
    expect(r.body).toBe("All done: delivered 12 Nov, 14:30, 2 containers returned. Thank you for shipping with NGB LOGISTICS. Next booking: bookings@ngb-logistics.example (fictional)");
    expect(r.url).toBe("/portal/shipments/NGB-2026-00012");
  });

  it("incident alert for operations", () => {
    const r = renderNotification({ template_key: "staff.incident_reported", payload: { ...sample, incident_type: "container_damage", container: "MSKU1234565", description: "Right door dented" } });
    expect(r.title).toBe("NGB-2026-00012: container damage");
    expect(r.body).toBe("MSKU1234565: Right door dented. Review it before the shipment can close.");
    expect(r.url).toBe(`/admin/shipments/${sample.shipment_id}`);
  });

  it("money and calendar-day text without floats or time-zone shifts", () => {
    expect(formatMoneyText("1234567.5", "KES")).toBe("1,234,567.50 KES");
    expect(formatMoneyText("0.10", "USD")).toBe("0.10 USD");
    expect(formatMoneyText("12.345", "USD")).toBeNull();
    expect(formatMoneyText(1234.5, "USD")).toBeNull(); // numbers are refused: amounts travel as text
    expect(formatDay("2026-01-31")).toBe("31 Jan 2026");
    expect(formatDay("2026-13-01")).toBeNull();
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
