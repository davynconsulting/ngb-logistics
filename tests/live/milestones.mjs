// Live: milestones through the real server actions (AC-02, AC-03, AC-04).
// Registers one fictional test shipment (2 containers) per run.
import { check, cn, finish, formAction, get, login, pageText, svc } from "./_shared.mjs";

console.log("— milestones —");
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const rec = (who, fields) => formAction(who, "recordMilestone", [ship.id, undefined],
  { idempotency_key: crypto.randomUUID(), event_at: ago(1), client_visible: "on", ...fields }, page).then((r) => r.value);
const fix = (who, eventId, fields) => formAction(who, "correctMilestone", [eventId, undefined], fields, page).then((r) => r.value);
const shipRow = async () => (await svc.from("shipments").select("overall_status, customs_status, actual_vessel_arrival").eq("id", ship.id).single()).data;
const contRow = async (id) => (await svc.from("containers").select("*").eq("id", id).single()).data;
const events = async () => (await svc.from("milestone_events").select("*").eq("shipment_id", ship.id).order("recorded_at")).data;

const doc = await login("doc.officer@ngb.example");
const ops = await login("ops.manager@ngb.example");
const agent = await login("clearing.agent@ngb.example");
const transport = await login("transport@ngb.example");
const finance = await login("finance@ngb.example");
const aline = await login("aline@akagera.example");
const jean = await login("jean@kivuhardware.example");

const stamp = Date.now().toString().slice(-6);
const { data: akagera } = await svc.from("organizations").select("id").eq("client_code", "AKAGERA").single();
const { data: dar } = await svc.from("ports").select("id").eq("code", "TZDAR").single();
const reg = await doc.api.rpc("register_shipment", {
  p_shipment: { client_id: akagera.id, bl_number: `TESTBLMS${stamp}`, origin_port_id: dar.id, destination_country: "RW",
    destination_city: "Kigali", cargo_description: "Milestone workflow test cargo (fictional)" },
  p_containers: [{ container_number: cn(600000 + (+stamp % 200000)), size_type: "40HC" }, { container_number: cn(800000 + (+stamp % 199999)), size_type: "20GP" }] });
if (reg.error) throw new Error("fixture: " + reg.error.message);
const { data: ship } = await svc.from("shipments").select("id, shipment_reference, containers(id, container_number)")
  .eq("id", reg.data[0].shipment_id).order("container_number", { referencedTable: "containers" }).single();
const page = `/admin/shipments/${ship.id}`;
const [c1, c2] = ship.containers.map((c) => c.id);
const { data: agentProfile } = await svc.from("profiles").select("id").eq("email", "clearing.agent@ngb.example").single();
await svc.from("shipment_assignments").insert({ shipment_id: ship.id, user_id: agentProfile.id });
console.log(`fixture: ${ship.shipment_reference} with 2 containers, agent assigned\n`);

// ---- confirm ----
const notStaff = await formAction(finance, "recordMilestone", [ship.id, undefined],
  { idempotency_key: crypto.randomUUID(), event_at: ago(1), milestone: "shipment_confirmed" }, page);
check("finance cannot record (action refuses, nothing recorded)", !notStaff.value?.ok && (await events()).length === 0, `status ${notStaff.status}`);
const early = await rec(agent, { milestone: "vessel_arrived", location: "Dar es Salaam port" });
check("milestones need a confirmed shipment", early?.error && /Confirm the shipment/.test(early.error), early?.error);
const conf = await rec(doc, { milestone: "shipment_confirmed", event_at: ago(48) });
check("doc officer confirms the shipment", conf?.ok, JSON.stringify(conf));
check("missing documents → awaiting documents", (await shipRow()).overall_status === "awaiting_documents", (await shipRow()).overall_status);

// ---- vessel + per-container discharge ----
const noLoc = await rec(agent, { milestone: "vessel_arrived" });
check("vessel arrival needs a location", /location/i.test(noLoc?.error ?? ""), noLoc?.error);
const bad = await rec(agent, { milestone: "vessel_arrived", location: "Dar", event_at: new Date(Date.now() + 2 * 3600e3).toISOString() });
check("future event time refused", /future/.test(bad?.error ?? ""), bad?.error);
check("assigned agent records vessel arrival", (await rec(agent, { milestone: "vessel_arrived", location: "Dar es Salaam port", event_at: ago(40) }))?.ok);
check("vessel arrival sets actual arrival and moves both containers",
  !!(await shipRow()).actual_vessel_arrival && (await contRow(c1)).operational_status === "vessel_arrived" && (await contRow(c2)).operational_status === "vessel_arrived");

const key = crypto.randomUUID();
const d1 = await formAction(agent, "recordMilestone", [ship.id, undefined],
  { idempotency_key: key, event_at: ago(30), milestone: "container_discharged", container_ids: [c1], location: "TICTS", location_kind: "terminal", client_visible: "on" }, page);
const d1again = await formAction(agent, "recordMilestone", [ship.id, undefined],
  { idempotency_key: key, event_at: ago(30), milestone: "container_discharged", container_ids: [c1], location: "TICTS", location_kind: "terminal", client_visible: "on" }, page);
check("container 1 discharged", d1.value?.ok, JSON.stringify(d1.value));
check("double submit (same key) records once", d1again.value?.ok && (await events()).filter((e) => e.milestone_type === "container_discharged").length === 1);
check("containers move independently (AC-02)",
  (await contRow(c1)).operational_status === "container_discharged" && (await contRow(c2)).operational_status === "vessel_arrived");
check("shipment shows the least-advanced container", (await shipRow()).overall_status === "vessel_arrived", (await shipRow()).overall_status);

// ---- transition control + override (AC-04) ----
const skip = await rec(agent, { milestone: "port_processing_started", container_ids: [c2] });
check("container 2 cannot skip discharge", /Not allowed now/.test(skip?.error ?? ""), skip?.error);
const agentOverride = await rec(agent, { milestone: "port_processing_started", container_ids: [c2], override_reason: "Terminal confirmed by phone" });
check("agent cannot override", /operations manager/.test(agentOverride?.error ?? ""), agentOverride?.error);
const shortReason = await rec(ops, { milestone: "port_processing_started", container_ids: [c2], override_reason: "x" });
check("override reason must be meaningful", shortReason?.fieldErrors?.overrideReason, JSON.stringify(shortReason));
const ovr = await rec(ops, { milestone: "port_processing_started", container_ids: [c2], override_reason: "Terminal confirmed discharge by phone; report to follow", event_at: ago(20) });
check("ops manager overrides with a reason", ovr?.ok, JSON.stringify(ovr));
const ovrEvent = (await events()).find((e) => e.is_override);
check("override is flagged and kept with its reason", ovrEvent?.override_reason?.startsWith("Terminal confirmed") && ovrEvent.container_id === c2);
const tc = await rec(transport, { milestone: "customs_released" });
check("transport coordinator cannot record customs", /cannot record/.test(tc?.error ?? ""), tc?.error);

// ---- visibility ----
check("agent adds a staff-only update with an internal note",
  (await rec(agent, { milestone: "update", public_note: "Checking storage charges", internal_note: "Terminal asked for extra fee — query it", client_visible: "" }))?.ok);
const alineEvents = (await aline.api.rpc("client_timeline", { p_shipment_id: ship.id })).data ?? [];
check("client cannot read the raw event table (internal reasons stay internal)", ((await aline.api.from("milestone_events").select("id").eq("shipment_id", ship.id)).data ?? []).length === 0);
check("client sees client-visible milestones of its shipment", alineEvents.length >= 4, String(alineEvents.length));
check("client does not see the staff-only update", !alineEvents.some((e) => e.milestone_type === "update"));
check("client cannot read internal notes", ((await aline.api.from("milestone_internal_notes").select("id").eq("shipment_id", ship.id)).data ?? []).length === 0);
check("another client sees nothing (AC-05)", ((await jean.api.from("milestone_events").select("id").eq("shipment_id", ship.id)).data ?? []).length === 0);
const direct = await ops.api.from("milestone_events").insert({ shipment_id: ship.id, batch_id: crypto.randomUUID(), milestone_type: "delivered", event_at: ago(1) });
check("events cannot be inserted directly, even by staff", !!direct.error, direct.error?.code);
const edit = await ops.api.from("milestone_events").update({ public_note: "rewritten" }).eq("shipment_id", ship.id).select("id");
check("events cannot be edited", !!edit.error || (edit.data ?? []).length === 0, edit.error?.code);

// ---- corrections (AC-03) ----
const dis = (await events()).find((e) => e.milestone_type === "container_discharged");
const noReason = await fix(agent, dis.id, { mode: "correct", reason: "", event_at: ago(31) });
check("a correction needs a reason", noReason?.fieldErrors?.reason, JSON.stringify(noReason));
const newAt = ago(31);
check("recorder corrects the discharge time", (await fix(agent, dis.id, { mode: "correct", reason: "Terminal report shows 1 h earlier", event_at: newAt }))?.ok);
const tl = (await ops.api.from("milestone_timeline").select("*").eq("id", dis.id).single()).data;
check("original kept, timeline shows the correction", tl.is_corrected && Math.abs(new Date(tl.event_at) - new Date(newAt)) < 1000 && tl.original_event_at === dis.event_at);
check("container discharge time follows", Math.abs(new Date((await contRow(c1)).discharge_at) - new Date(newAt)) < 1000);
const notMine = await fix(transport, ovrEvent.id, { mode: "cancel", reason: "mistake" });
check("transport cannot cancel the ops manager's event", /Only the person/.test(notMine?.error ?? ""), notMine?.error);
check("ops manager cancels the override", (await fix(ops, ovrEvent.id, { mode: "cancel", reason: "Discharge not confirmed after all" }))?.ok);
check("cancel restores container 2", (await contRow(c2)).operational_status === "vessel_arrived", (await contRow(c2)).operational_status);
const again = await fix(ops, ovrEvent.id, { mode: "cancel", reason: "again" });
check("cannot cancel twice", /already been cancelled/.test(again?.error ?? ""), again?.error);
const vessel = (await events()).find((e) => e.milestone_type === "vessel_arrived");
const dep = await fix(ops, vessel.id, { mode: "cancel", reason: "wrong vessel" });
check("an event with later milestones cannot be cancelled", /Later milestones/.test(dep?.error ?? ""), dep?.error);

// ---- pages ----
const opsPage = await pageText(await get(page, ops));
check("ops page: form, timeline, override and internal note shown",
  opsPage.includes("Record a milestone") && opsPage.includes("Timeline") && opsPage.includes("Override") && opsPage.includes("Terminal asked for extra fee"));
check("ops page: correction and cancellation shown", opsPage.includes("Terminal report shows 1 h earlier") && opsPage.includes("Discharge not confirmed after all"));
const finPage = await pageText(await get(page, finance));
check("finance page: timeline without the record form", finPage.includes("Timeline") && !finPage.includes("Record a milestone"));
const clientPage = await pageText(await get(page, aline));
check("client cannot open the admin page", !clientPage.includes("Terminal asked for extra fee") && !clientPage.includes("Record a milestone"));

finish();
