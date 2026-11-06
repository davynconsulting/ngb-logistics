// Container return, incidents and shipment closure against the dev project (0024, AC-14/15).
// Registers one fictional test shipment per run and takes it from arrival to closed and reopened.
import { check, cn, finish, formAction, get, login, pageText, svc } from "./_shared.mjs";

console.log("Closure:");
const stamp = Date.now().toString().slice(-6);
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();

const doc = await login("doc.officer@ngb.example");
const ops = await login("ops.manager@ngb.example");
const transport = await login("transport@ngb.example");
const finance = await login("finance@ngb.example");
const aline = await login("aline@akagera.example");
const { data: akagera } = await svc.from("organizations").select("id").eq("client_code", "AKAGERA").single();
const { data: dar } = await svc.from("ports").select("id").eq("code", "TZDAR").single();
const { data: kgl } = await svc.from("routes").select("id").eq("code", "DAR-KGL").single();

// ---- fixture: two containers, delivered ----
const reg = await doc.api.rpc("register_shipment", {
  p_shipment: { client_id: akagera.id, bl_number: `TESTBLCLS${stamp}`, origin_port_id: dar.id, destination_country: "RW",
    destination_city: "Kigali", cargo_description: "Closure test cargo: floor tiles (fictional)" },
  p_containers: [{ container_number: cn(600000 + (+stamp % 99999)), size_type: "40HC" }, { container_number: cn(500000 + (+stamp % 99999)), size_type: "20GP" }] });
if (reg.error) throw new Error("fixture: " + reg.error.message);
const shipId = reg.data[0].shipment_id;
const { data: ship } = await svc.from("shipments").select("shipment_reference, containers(id, container_number)")
  .eq("id", shipId).order("container_number", { referencedTable: "containers" }).single();
const REF = ship.shipment_reference;
const [c1, c2] = ship.containers.map((c) => c.id);
const ms = async (who, m, extra = {}, h = 6) => {
  const r = await who.api.rpc("record_milestone", { p_shipment_id: shipId, p_milestone: m, p_event_at: ago(h), ...extra });
  if (r.error) throw new Error(`fixture ${m}: ${r.error.message}`);
};
await ms(ops, "shipment_confirmed", {}, 30);
await ms(ops, "vessel_arrived", { p_location: "Dar es Salaam" }, 29);
await ms(ops, "container_discharged", { p_container_ids: [c1, c2], p_location: "TICTS" }, 28);
await ms(ops, "port_processing_started", { p_container_ids: [c1, c2] }, 27);
await ms(ops, "ready_for_dispatch", { p_container_ids: [c1, c2] }, 26);
for (const m of ["customs_entry_prepared", "customs_submitted", "customs_released"]) await ms(ops, m, {}, 25);
const t = await transport.api.rpc("assign_transport", { p_shipment_id: shipId, p_container_ids: [c1, c2], p_route_id: kgl.id,
  p_transporter_name: "Kagera Haulage (TEST)", p_truck_registration: `T ${stamp.slice(0, 3)} CLS`, p_driver_name: "Jean B. (TEST)" });
if (t.error) throw new Error("fixture truck: " + t.error.message);
await ms(transport, "loaded", { p_container_ids: [c1, c2] }, 24);
await ms(transport, "gate_out", { p_container_ids: [c1, c2], p_location: "Dar ICD" }, 23);
await ms(transport, "arrived", { p_container_ids: [c1, c2] }, 5);
await ms(transport, "delivered", { p_container_ids: [c1, c2] }, 4);
console.log(`fixture: ${REF}, both containers delivered\n`);

const PAGE = `/admin/shipments/${shipId}`;
const html = async (path, who) => pageText(await get(path, who));
const ct = async (id) => (await svc.from("containers").select("return_status, return_deadline, return_depot, return_charges_note, condition, condition_note").eq("id", id).single()).data;
const st = async () => (await svc.from("shipments").select("overall_status, return_status, finance_status, closed_at, closed_by, closure_note").eq("id", shipId).single()).data;
const err = (r) => r.value?.error ?? JSON.stringify(r.value?.fieldErrors ?? r.value);

// ---- return terms ----
let page = await html(PAGE, ops);
check("admin page shows Container return, Incidents and Closure", ["Container return", "Incidents", "Closure checklist"].every((x) => page.includes(x)));
check("both containers await empty return after delivery (AC-14)", (await ct(c1)).return_status === "awaiting_empty_return");
const nextWeek = new Date(Date.now() + 7 * 864e5).toISOString(), yesterday = new Date(Date.now() - 864e5).toISOString();
let r = await formAction(aline, "setReturnTerms", [undefined], { container_ids: [c1], deadline: nextWeek, depot: "X" }, PAGE);
check("client cannot set return terms", !(await ct(c1)).return_depot, err(r));
r = await formAction(transport, "setReturnTerms", [undefined],
  { container_ids: [c1, c2], deadline: nextWeek, depot: "Kigali ICD empty depot (TEST)", charges: "Detention USD 40/day after the deadline (TEST)" }, PAGE);
check("transport coordinator sets the deadline, depot and charges", r.value?.ok && (await ct(c2)).return_depot === "Kigali ICD empty depot (TEST)", err(r));
r = await formAction(transport, "setReturnTerms", [undefined], { container_ids: [c1], deadline: yesterday, depot: "Kigali ICD empty depot (TEST)" }, PAGE);
check("a passed deadline makes the return overdue", r.value?.ok && (await ct(c1)).return_status === "return_overdue" && (await st()).return_status === "return_overdue", err(r));
const portal = await html(`/portal/shipments/${REF}`, aline);
check("client portal shows the return depot and charges", portal.includes("Return the empty container to Kigali ICD empty depot (TEST)") && portal.includes("Detention USD 40/day"));
await formAction(transport, "setReturnTerms", [undefined], { container_ids: [c1], deadline: nextWeek, depot: "Kigali ICD empty depot (TEST)" }, PAGE);
check("extending the deadline → awaiting return again", (await ct(c1)).return_status === "awaiting_empty_return");

// ---- condition and incidents ----
r = await formAction(transport, "recordCondition", [c2, undefined], { condition: "damaged", note: "" }, PAGE);
check("damage needs a note", !(await ct(c2)).condition, err(r));
r = await formAction(transport, "recordCondition", [c2, undefined], { condition: "damaged", note: "Door hinge bent on return inspection (TEST)" }, PAGE);
const incs = async () => (await svc.from("incidents").select("id, incident_type, status, container_id").eq("shipment_id", shipId).order("reported_at")).data ?? [];
let [inc] = await incs();
check("damage recorded and a container-damage incident opened", r.value?.ok && (await ct(c2)).condition === "damaged" && inc?.incident_type === "container_damage" && inc.container_id === c2, err(r));
const staffN = (await svc.from("notifications").select("id").eq("template_key", "staff.incident_reported").eq("shipment_id", shipId)).data ?? [];
check("ops are alerted about the incident", staffN.length > 0);
r = await formAction(finance, "reportIncident", [shipId, undefined], { type: "cargo_shortage", description: "Two cartons missing (TEST)" }, PAGE);
check("finance cannot report incidents", (await incs()).length === 1, err(r));
r = await formAction(doc, "reportIncident", [shipId, undefined], { type: "cargo_shortage", container_id: c1, description: "Two cartons short against the packing list (TEST)" }, PAGE);
check("doc officer reports a cargo shortage", r.value?.ok && (await incs()).length === 2, err(r));
check("client cannot read incidents", ((await aline.api.from("incidents").select("id")).data ?? []).length === 0);
const [, inc2] = await incs();
r = await formAction(doc, "addIncidentNote", [inc2.id, undefined], { note: "Client confirmed the count by phone (TEST)" }, PAGE);
check("doc officer adds a note", r.value?.ok && ((await svc.from("incident_notes").select("id").eq("incident_id", inc2.id)).data ?? []).length === 1, err(r));
r = await formAction(transport, "resolveIncident", [inc2.id, undefined], { resolution: "Accepted shortage, credit agreed (TEST)" }, PAGE);
check("transport coordinator cannot resolve incidents", (await incs())[1].status === "open", err(r));

// ---- closure ----
const checks = async () => Object.fromEntries(((await ops.api.rpc("closure_checks", { p_shipment_id: shipId })).data ?? []).map((c) => [c.check_key, c.ok]));
let c = await checks();
check("checklist: POD, returns, incidents and finance missing", !c.pod && !c.returned && !c.incidents && !c.finance, JSON.stringify(c));
r = await formAction(ops, "closeShipment", [shipId, undefined], { note: "" }, PAGE);
check("closing is refused with the missing items", /Cannot close yet/.test(r.value?.error ?? "") && !(await st()).closed_at, err(r));
check("client gets no checklist", ((await aline.api.rpc("closure_checks", { p_shipment_id: shipId })).data ?? []).length === 0);
await ms(doc, "pod_received", { p_container_ids: [c1, c2] }, 3);
await ms(transport, "empty_returned", { p_container_ids: [c1, c2], p_location: "Kigali ICD empty depot (TEST)" }, 2);
for (const i of await incs()) {
  r = await formAction(ops, "resolveIncident", [i.id, undefined], { resolution: "Reviewed with the client and the transporter (TEST)" }, PAGE);
}
check("ops manager resolves both incidents", (await incs()).every((i) => i.status === "resolved"), err(r));
c = await checks();
check("only finance is still open", c.pod && c.returned && c.incidents && !c.finance, JSON.stringify(c));
r = await formAction(ops, "approveCredit", [shipId, undefined], { reason: "Invoice to follow (TEST)" }, PAGE);
check("ops manager cannot approve credit", (await st()).finance_status === "not_invoiced", err(r));
r = await formAction(finance, "approveCredit", [shipId, undefined], { reason: "Long-standing client; invoice to follow on monthly statement (TEST)" }, PAGE);
check("finance approves closure on credit", r.value?.ok && (await st()).finance_status === "credit_approved", err(r));
page = await html(PAGE, ops);
check("page offers Close once every item is done", page.includes("Close shipment") && !page.includes("Closing is possible once every item is done"));
r = await formAction(transport, "closeShipment", [shipId, undefined], { note: "" }, PAGE);
check("transport coordinator cannot close", !(await st()).closed_at, err(r));
r = await formAction(ops, "closeShipment", [shipId, undefined], { note: "All complete (TEST)" }, PAGE);
let s = await st();
check("ops manager closes the shipment (AC-15)", r.value?.ok && s.overall_status === "closed" && !!s.closed_at && s.closure_note === "All complete (TEST)", err(r));
const closedN = (await svc.from("notifications").select("id, payload").eq("template_key", "shipment.closed").eq("shipment_id", shipId)).data ?? [];
check("client is told the shipment is closed", closedN.length > 0 && closedN[0].payload?.containers === 2, JSON.stringify(closedN[0]?.payload));
r = await formAction(doc, "reportIncident", [shipId, undefined], { type: "other", description: "Late remark after closing (TEST)" }, PAGE);
check("no new incidents on a closed shipment", (await incs()).length === 2, err(r));

// ---- reopen ----
r = await formAction(ops, "reopenShipment", [shipId, undefined], { reason: "" }, PAGE);
check("reopening needs a reason", (await st()).overall_status === "closed", err(r));
r = await formAction(ops, "reopenShipment", [shipId, undefined], { reason: "Client queried the shortage credit (TEST)" }, PAGE);
s = await st();
check("ops manager reopens with a reason", r.value?.ok && s.overall_status !== "closed" && !s.closed_at, err(r));
const log = (await svc.from("shipment_closure_log").select("action").eq("shipment_id", shipId).order("occurred_at")).data ?? [];
check("closure log keeps both entries", log.map((l) => l.action).join() === "closed,reopened", JSON.stringify(log));
const del = await svc.from("shipment_closure_log").delete().eq("shipment_id", shipId);
check("closure log is append-only (even for the service role)", !!del.error);

finish();
