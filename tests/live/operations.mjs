// Live: ETA revisions, transport and exceptions through the real server actions (AC-09, AC-10).
// Registers one fictional test shipment (2 containers) per run.
import { action, check, cn, finish, formAction, get, login, pageText, svc } from "./_shared.mjs";

console.log("— ETA, transport, exceptions —");
const ahead = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const act = (who, name, bound, fields) => formAction(who, name, [bound, undefined], fields, page).then((r) => r.value);

const doc = await login("doc.officer@ngb.example");
const ops = await login("ops.manager@ngb.example");
const transport = await login("transport@ngb.example");
const finance = await login("finance@ngb.example");
const driver = await login("driver@ngb.example");
const aline = await login("aline@akagera.example");

const stamp = Date.now().toString().slice(-6);
const { data: akagera } = await svc.from("organizations").select("id").eq("client_code", "AKAGERA").single();
const { data: dar } = await svc.from("ports").select("id").eq("code", "TZDAR").single();
const reg = await doc.api.rpc("register_shipment", {
  p_shipment: { client_id: akagera.id, bl_number: `TESTBLOPS${stamp}`, origin_port_id: dar.id, destination_country: "RW",
    destination_city: "Kigali", cargo_description: "Transport and exception test cargo (fictional)" },
  p_containers: [{ container_number: cn(200000 + (+stamp % 100000)), size_type: "40HC" }, { container_number: cn(300000 + (+stamp % 100000)), size_type: "40HC" }] });
if (reg.error) throw new Error("fixture: " + reg.error.message);
const shipId = reg.data[0].shipment_id;
const { data: ship } = await svc.from("shipments").select("id, shipment_reference, containers(id, container_number)")
  .eq("id", shipId).order("container_number", { referencedTable: "containers" }).single();
const page = `/admin/shipments/${shipId}`;
const [c1, c2] = ship.containers.map((c) => c.id);
// move to "ready for dispatch" with the real RPC (as the ops manager)
const rpc = (who, m, at, extra = {}) => who.api.rpc("record_milestone", { p_shipment_id: shipId, p_milestone: m, p_event_at: at, ...extra });
for (const [m, extra] of [["shipment_confirmed", {}], ["vessel_arrived", { p_location: "Dar es Salaam" }],
  ["container_discharged", { p_container_ids: [c1, c2], p_location: "TICTS" }], ["port_processing_started", { p_container_ids: [c1, c2] }],
  ["ready_for_dispatch", { p_container_ids: [c1, c2] }]]) {
  const r = await rpc(ops, m, ago(5), extra);
  if (r.error) throw new Error(`fixture ${m}: ${r.error.message}`);
}
console.log(`fixture: ${ship.shipment_reference}, both containers ready for dispatch\n`);

// ---- ETA (AC-09) ----
const noReason = await act(transport, "reviseEta", shipId, { new_eta: ahead(72), category: "schedule_confirmed", reason: "", client_visible: "on" });
check("ETA without a reason is refused", noReason?.fieldErrors?.reason, JSON.stringify(noReason));
const finEta = await formAction(finance, "reviseEta", [shipId, undefined], { new_eta: ahead(72), category: "schedule_confirmed", reason: "Plan", client_visible: "on" }, page);
check("finance cannot revise the ETA", !finEta.value?.ok && ((await svc.from("eta_revisions").select("id").eq("shipment_id", shipId)).data ?? []).length === 0);
const eta1 = await act(transport, "reviseEta", shipId, { new_eta: ahead(72), category: "schedule_confirmed", reason: "Loading planned today; 3 days to Kigali", client_visible: "on" });
check("transport sets the first ETA (material)", eta1?.ok && /material/.test(eta1.message), eta1?.message);
const eta2 = await act(transport, "reviseEta", shipId, { new_eta: ahead(73), category: "road_conditions", reason: "Road works near Morogoro", client_visible: "on" });
check("+1 h is below the threshold", eta2?.ok && /below the notification threshold/.test(eta2.message), eta2?.message);
const { data: shipEta } = await svc.from("shipments").select("current_eta, eta_reason").eq("id", shipId).single();
check("shipment shows the latest ETA and reason", shipEta.eta_reason === "Road works near Morogoro" && Math.abs(new Date(shipEta.current_eta) - new Date(ahead(73))) < 60e3);
const alineRevs = (await aline.api.from("eta_revisions").select("previous_eta, new_eta, reason").eq("shipment_id", shipId)).data ?? [];
check("client sees both revisions, previous ETA kept (auditable)", alineRevs.length === 2 && alineRevs.some((r) => r.previous_eta));

// ---- transport ----
const { data: kgl } = await svc.from("routes").select("id").eq("code", "DAR-KGL").single();
const { data: driverProfile } = await svc.from("profiles").select("id").eq("email", "driver@ngb.example").single();
const truck = `T ${stamp.slice(0, 3)} TST`;
const badPhone = await act(transport, "assignTransport", shipId, { container_ids: [c1], transporter: "Kagera Haulage (TEST)", truck, driver_name: "Eric (TEST)", driver_phone: "0788", transit_refs: "" });
check("bad driver phone refused", badPhone?.fieldErrors?.driverPhone, JSON.stringify(badPhone));
const as1 = await act(transport, "assignTransport", shipId, {
  container_ids: [c1], transporter: "Kagera Haulage (TEST)", truck: truck.toLowerCase(), trailer: "tl 12", driver_name: "Eric Niyonzima (TEST)",
  driver_phone: "+250 788 000 222", driver_user_id: driverProfile.id, route_id: kgl.id, planned_loading_at: ahead(2), transit_refs: "T1-TEST-1",
});
check("transport assigns a truck with driver and route", as1?.ok, JSON.stringify(as1));
const { data: a1 } = await svc.from("transport_assignments").select("id, truck_registration, border_crossing, transit_document_refs").eq("shipment_id", shipId).single();
check("registration normalised; border from the route", a1?.truck_registration === truck && a1.border_crossing === "Rusumo", JSON.stringify(a1));
check("container 1 → truck assigned", (await svc.from("containers").select("operational_status").eq("id", c1).single()).data.operational_status === "truck_assigned");
check("client cannot read driver name/phone", ((await aline.api.from("driver_contacts").select("driver_phone")).data ?? []).length === 0);
check("client sees the truck", ((await aline.api.from("transport_assignments").select("truck_registration").eq("shipment_id", shipId)).data ?? []).length === 1);
check("assigned driver now sees the shipment", ((await driver.api.from("shipments").select("id").eq("id", shipId)).data ?? []).length === 1);
const again = await act(transport, "assignTransport", shipId, { container_ids: [c1], transporter: "Other (TEST)", truck: "T 999 ZZZ", transit_refs: "" });
check("a second truck for the same container is refused", /already has a truck/.test(again?.error ?? ""), again?.error);

await rpc(transport, "loaded", ago(1), { p_container_ids: [c1] });
for (const m of ["customs_entry_prepared", "customs_submitted", "customs_released"]) await rpc(ops, m, ago(1));
const as2 = await act(transport, "assignTransport", shipId, { container_ids: [c2], transporter: "Rusizi Trucks (TEST)", truck: `T ${stamp.slice(0, 3)} TSU`, transit_refs: "" });
check("truck for container 2", as2?.ok, JSON.stringify(as2));
await rpc(transport, "loaded", ago(0.5), { p_container_ids: [c2] });
const { data: a2 } = await svc.from("transport_assignments").select("id").eq("shipment_id", shipId).eq("truck_registration", `T ${stamp.slice(0, 3)} TSU`).single();
const cancel = await formAction(transport, "cancelTransport", [a2.id, undefined], { reason: "Truck broke down at the ICD (TEST)" }, page);
check("transport cancels container 2's truck", cancel.value?.ok, JSON.stringify(cancel.value));
const gate2 = await rpc(transport, "gate_out", ago(0.2), { p_container_ids: [c2], p_location: "Dar ICD" });
check("gate-out without a truck is blocked", /Assign a truck/.test(gate2.error?.message ?? ""), gate2.error?.message);
const gate1 = await rpc(transport, "gate_out", ago(0.2), { p_container_ids: [c1], p_location: "Dar ICD" });
check("gate-out with truck + customs release works", !gate1.error, gate1.error?.message);

// ---- exceptions (AC-10) ----
const opened = await act(doc, "openException", shipId, { type: "dispatch_risk", severity: "high", title: "Replacement truck needed for container 2 (TEST)",
  details: "Breakdown at the ICD", container_id: c2, next_action: "Find a replacement truck", follow_up_at: ahead(3) });
check("doc officer opens an exception", opened?.ok, JSON.stringify(opened));
const { data: x } = await svc.from("exceptions").select("id, owner_id, last_event_id, status").eq("shipment_id", shipId).eq("source", "staff").single();
check("shipment flagged; owner and last event recorded", (await svc.from("shipments").select("has_open_exception").eq("id", shipId).single()).data.has_open_exception && x.owner_id && x.last_event_id);
check("client cannot read exceptions", ((await aline.api.from("exceptions").select("id").eq("shipment_id", shipId)).data ?? []).length === 0);
const { data: tp } = await svc.from("profiles").select("id").eq("email", "transport@ngb.example").single();
const reassign = await act(transport, "actOnException", x.id, { op: "update", owner_id: tp.id });
check("non-owner cannot reassign", /Only the owner/.test(reassign?.error ?? ""), reassign?.error);
check("ops manager reassigns to transport", (await act(ops, "actOnException", x.id, { op: "update", owner_id: tp.id, note: "Transport to source a truck" }))?.ok);
check("owner escalates", (await act(transport, "actOnException", x.id, { op: "escalate", note: "No trucks available today (TEST)" }))?.ok);
const queuePage = await pageText(await get("/admin/exceptions?filter=escalated", ops));
check("escalated exception is in the ops manager queue with owner and next action",
  queuePage.includes("Replacement truck needed for container 2 (TEST)") && queuePage.includes("Find a replacement truck"));
const scan = await action(ops, "runSlaCheck", [], "/admin/exceptions");
check("ops manager runs the SLA check", /\/admin\/exceptions\?scan=\d+-\d+-\d+/.test(scan.redirect ?? ""), scan.redirect);
const scanT = await action(transport, "runSlaCheck", [], "/admin/exceptions");
check("transport coordinator cannot run it", !/scan=\d/.test(scanT.redirect ?? ""), scanT.redirect);
check("owner resolves", (await act(transport, "actOnException", x.id, { op: "resolve", resolution: "Replacement truck found (TEST)" }))?.ok);
const { data: logRows } = await svc.from("exception_updates").select("kind").eq("exception_id", x.id);
check("every step is in the exception log", ["opened", "owner", "note", "escalated", "resolved"].every((k) => logRows.some((r) => r.kind === k)), logRows.map((r) => r.kind).join(","));

// ---- pages ----
const opsPage = await pageText(await get(page, ops));
check("shipment page: ETA, transport with driver, exceptions",
  opsPage.includes("ETA at destination") && opsPage.includes(truck) && opsPage.includes("Eric Niyonzima (TEST)") && opsPage.includes("Exceptions"));
const driverQueue = await pageText(await get("/admin/exceptions", driver));
check("driver cannot open the exceptions queue", !driverQueue.includes("Replacement truck needed"));
const clientPage = await pageText(await get(page, aline));
check("client cannot open the admin page", !clientPage.includes("Eric Niyonzima"));

finish();
