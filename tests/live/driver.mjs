// Driver pages against the dev project (0020): routing, own-truck-only updates, problem reports, uploads, consent.
// Registers one fictional test shipment (2 containers, 2 trucks) per run.
import { action, check, cn, createClient, finish, formAction, get, login, pageText, svc } from "./_shared.mjs";

console.log("Driver:");
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const stamp = Date.now().toString().slice(-6);

const doc = await login("doc.officer@ngb.example");
const ops = await login("ops.manager@ngb.example");
const transport = await login("transport@ngb.example");
const driver = await login("driver@ngb.example");
const aline = await login("aline@akagera.example");
const { data: akagera } = await svc.from("organizations").select("id, show_driver_contact").eq("client_code", "AKAGERA").single();
const { data: dar } = await svc.from("ports").select("id").eq("code", "TZDAR").single();
const { data: kgl } = await svc.from("routes").select("id").eq("code", "DAR-KGL").single();
const { data: driverP } = await svc.from("profiles").select("id").eq("email", "driver@ngb.example").single();

// ---- fixture: both containers through gate-out; container 1 on the driver's truck, container 2 on another ----
const reg = await doc.api.rpc("register_shipment", {
  p_shipment: { client_id: akagera.id, bl_number: `TESTBLDRV${stamp}`, origin_port_id: dar.id, destination_country: "RW",
    destination_city: "Kigali", delivery_address: "Akagera Traders warehouse, KK 15 Rd, Kigali (fictional)",
    cargo_description: "Driver test cargo: cement bags (fictional)" },
  p_containers: [{ container_number: cn(800000 + (+stamp % 100000)), size_type: "40HC" }, { container_number: cn(900000 + (+stamp % 99999)), size_type: "20GP" }] });
if (reg.error) throw new Error("fixture: " + reg.error.message);
const shipId = reg.data[0].shipment_id;
const { data: ship } = await svc.from("shipments").select("shipment_reference, assigned_ops_user_id, containers(id, container_number)")
  .eq("id", shipId).order("container_number", { referencedTable: "containers" }).single();
const REF = ship.shipment_reference;
const [c1, c2] = ship.containers.map((c) => c.id);
const ms = async (who, m, extra = {}) => {
  const r = await who.api.rpc("record_milestone", { p_shipment_id: shipId, p_milestone: m, p_event_at: ago(6), ...extra });
  if (r.error) throw new Error(`fixture ${m}: ${r.error.message}`);
};
await ms(ops, "shipment_confirmed");
await ms(ops, "vessel_arrived", { p_location: "Dar es Salaam" });
await ms(ops, "container_discharged", { p_container_ids: [c1, c2], p_location: "TICTS" });
await ms(ops, "port_processing_started", { p_container_ids: [c1, c2] });
await ms(ops, "ready_for_dispatch", { p_container_ids: [c1, c2] });
for (const m of ["customs_entry_prepared", "customs_submitted", "customs_released"]) await ms(ops, m);
const truck = (n, extra = {}) => transport.api.rpc("assign_transport", { p_shipment_id: shipId, p_transporter_name: "Kagera Haulage (TEST)",
  p_route_id: kgl.id, ...extra, p_truck_registration: `T ${stamp.slice(0, 3)} DR${n}` });
const t1 = await truck(1, { p_container_ids: [c1], p_driver_name: "Eric Niyonzima (TEST)", p_driver_phone: "+250788000444", p_driver_user_id: driverP.id });
const t2 = await truck(2, { p_container_ids: [c2], p_driver_name: "Paul K. (TEST)" });
if (t1.error || t2.error) throw new Error("fixture trucks: " + (t1.error ?? t2.error).message);
const A1 = t1.data, A2 = t2.data;
await ms(transport, "loaded", { p_container_ids: [c1, c2] });
await ms(transport, "gate_out", { p_container_ids: [c1, c2], p_location: "Dar ICD" });
const JOB = `/driver/jobs/${A1}`;
console.log(`fixture: ${REF}, container 1 on the driver's truck, both in transit\n`);

// ---- routing ----
const loc = async (path, who) => (await get(path, who)).headers.get("location") ?? "";
check("driver opening /admin → /driver", (await loc("/admin", driver)).endsWith("/driver"));
check("driver opening an admin shipment page → /driver", (await loc(`/admin/shipments/${shipId}`, driver)).endsWith("/driver"));
check("driver opening /portal → /driver", (await loc("/portal", driver)).endsWith("/driver"));
check("office staff opening /driver → /admin", (await loc("/driver", ops)).endsWith("/admin"));
check("client opening /driver → /portal", (await loc(`/driver/jobs/${A1}`, aline)).endsWith("/portal"));
check("signed-out /driver → /login", (await loc("/driver")).includes("/login"));

// ---- what the driver sees ----
const home = await pageText(await get("/driver", driver));
check("job list shows the job with client, destination and truck", home.includes(REF) && home.includes("Akagera") && home.includes(`T ${stamp.slice(0, 3)} DR1`));
check("…not the other truck", !home.includes(`T ${stamp.slice(0, 3)} DR2`));
const jobPage = await pageText(await get(JOB, driver));
check("job page: delivery address, containers, road steps", jobPage.includes("KK 15 Rd") && jobPage.includes(ship.containers[0].container_number)
  && jobPage.includes("Update NGB and the client") && !jobPage.includes(ship.containers[1].container_number));
check("the other truck's job is 'not found'", /could not be found|not found/i.test(await pageText(await get(`/driver/jobs/${A2}`, driver))));
check("driver reads only their own profile", ((await driver.api.from("profiles").select("id")).data ?? []).length === 1);
check("driver reads no client organizations", ((await driver.api.from("organizations").select("id").eq("id", akagera.id)).data ?? []).length === 0);
check("driver cannot read milestone events or internal notes directly",
  ((await driver.api.from("milestone_events").select("id").eq("shipment_id", shipId)).data ?? []).length === 0
  && ((await driver.api.from("milestone_internal_notes").select("id").eq("shipment_id", shipId)).data ?? []).length === 0);
check("driver sees only their own truck", ((await driver.api.from("transport_assignments").select("id").eq("shipment_id", shipId)).data ?? []).map((a) => a.id).join() === A1);

// ---- road updates ----
const step = (fields) => formAction(driver, "recordDriverStep", [A1, undefined], fields, JOB).then((r) => r.value);
const key = crypto.randomUUID();
let r = await step({ milestone: "arrived_at_border", event_at: ago(0.3), container_ids: [c1], idempotency_key: key });
check("border arrival needs a location", r?.ok !== true && /location/i.test(r?.error ?? ""), JSON.stringify(r));
r = await step({ milestone: "arrived_at_border", event_at: ago(0.3), container_ids: [c1], location: "Rusumo (TEST)", note: "Queue of about 40 trucks", idempotency_key: key });
check("driver records 'at the border' for their container", r?.ok === true, JSON.stringify(r));
r = await step({ milestone: "arrived_at_border", event_at: ago(0.3), container_ids: [c1], location: "Rusumo (TEST)", idempotency_key: key });
const borderEv = (await svc.from("milestone_events").select("id, source, public_note, client_visible").eq("shipment_id", shipId).eq("milestone_type", "arrived_at_border")).data ?? [];
check("…a double tap records it once, as a driver event, no client-facing note",
  r?.ok === true && borderEv.length === 1 && borderEv[0].source === "driver" && borderEv[0].public_note === null, JSON.stringify(borderEv));
check("…the note reaches staff only", ((await ops.api.from("milestone_internal_notes").select("note").eq("shipment_id", shipId)).data ?? []).some((n) => n.note.includes("40 trucks")));
check("…the client sees the border update", ((await aline.api.rpc("client_timeline", { p_shipment_id: shipId })).data ?? []).some((e) => e.milestone_type === "arrived_at_border"));
r = await step({ milestone: "arrived_at_border", event_at: ago(0.2), container_ids: [c2], location: "Rusumo", idempotency_key: crypto.randomUUID() });
check("driver cannot update a container on another truck", r?.ok !== true, JSON.stringify(r));
const direct = await driver.api.rpc("record_milestone", { p_shipment_id: shipId, p_milestone: "arrived_at_border", p_event_at: ago(0.2), p_container_ids: [c2], p_location: "Rusumo" });
check("…not even by calling the database directly", /your truck/.test(direct.error?.message ?? ""), direct.error?.message);
r = await step({ milestone: "loaded", event_at: ago(0.2), container_ids: [c1], idempotency_key: crypto.randomUUID() });
check("driver cannot record port steps", r?.ok !== true);

// ---- problem report ----
const report = (fields) => formAction(driver, "reportProblem", [A1, undefined], fields, JOB).then((x) => x.value);
r = await report({ message: " ", idempotency_key: crypto.randomUUID() });
check("a problem report needs a description", r?.ok !== true && r?.fieldErrors?.message, JSON.stringify(r));
r = await report({ message: "Flat tyre near Kayonza, about 2 hours delay (TEST)", idempotency_key: crypto.randomUUID() });
check("driver reports a problem", r?.ok === true, JSON.stringify(r));
const staffNotes = (await svc.from("notifications").select("recipient_id").eq("template_key", "staff.driver_report").eq("shipment_id", shipId)).data ?? [];
check("the ops owner and the coordinator are notified", staffNotes.some((n) => n.recipient_id === ship.assigned_ops_user_id) && staffNotes.length >= 1, JSON.stringify(staffNotes));
const alineTimeline = (await aline.api.rpc("client_timeline", { p_shipment_id: shipId })).data ?? [];
check("the client sees nothing of the report", !JSON.stringify(alineTimeline).includes("Flat tyre"));

// ---- POD upload and delivery ----
const pdf = new Blob([`%PDF-1.4\n% driver POD ${stamp}\n`], { type: "application/pdf" });
const input = { shipmentId: shipId, documentType: "proof_of_delivery", fileName: "POD signed.pdf", mimeType: "application/pdf", clientVisible: true, containerId: c1, size: pdf.size };
const prep = (await action(driver, "prepareDocumentUpload", [input], JOB)).value;
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const up = prep?.ok ? await anon.storage.from("shipment-documents").uploadToSignedUrl(prep.path, prep.token, pdf, { contentType: "application/pdf" }) : { error: prep };
const fin = (await action(driver, "finalizeDocumentUpload", [{ ...input, documentId: prep?.documentId, path: prep?.path }], JOB)).value;
check("driver uploads a signed POD", !up.error && fin?.ok === true, JSON.stringify(up.error ?? fin));
const { data: podDoc } = await svc.from("documents").select("client_visible, uploaded_by").eq("id", prep?.documentId).single();
check("…hidden from the client until staff publish it", podDoc?.client_visible === false && podDoc.uploaded_by === driverP.id, JSON.stringify(podDoc));
check("…the client cannot see it", ((await aline.api.from("documents").select("id").eq("id", prep?.documentId)).data ?? []).length === 0);
const inv = (await action(driver, "prepareDocumentUpload", [{ ...input, documentType: "commercial_invoice" }], JOB)).value;
check("driver cannot upload a commercial invoice", inv?.ok === false);
await step({ milestone: "arrived", event_at: ago(0.1), container_ids: [c1], location: "Kigali (TEST)", idempotency_key: crypto.randomUUID() });
r = await step({ milestone: "delivered", event_at: ago(0.05), container_ids: [c1], location: "Akagera warehouse", evidence_ids: [prep?.documentId], idempotency_key: crypto.randomUUID() });
const { data: k1 } = await svc.from("containers").select("operational_status, delivery_status").eq("id", c1).single();
check("driver records delivery with the POD attached → POD received", r?.ok === true && k1.operational_status === "delivered" && k1.delivery_status === "pod_received", JSON.stringify([r, k1]));

// ---- contact sharing (the driver's own choice) ----
await svc.from("organizations").update({ show_driver_contact: true }).eq("id", akagera.id);
await action(driver, "setMyContactSharing", [A1, true], JOB);
let trucks = (await aline.api.rpc("client_transport", { p_shipment_id: shipId })).data ?? [];
check("driver shares their contact → the client sees it (policy on)", trucks.some((t) => t.driver_name === "Eric Niyonzima (TEST)"), JSON.stringify(trucks));
await action(driver, "setMyContactSharing", [A1, false], JOB);
trucks = (await aline.api.rpc("client_transport", { p_shipment_id: shipId })).data ?? [];
check("driver stops sharing → hidden again", !trucks.some((t) => t.driver_name), JSON.stringify(trucks));
await action(driver, "setMyContactSharing", [A2, true], JOB);
check("driver cannot change another truck's driver consent", (await svc.from("driver_contacts").select("share_with_client").eq("assignment_id", A2).single()).data.share_with_client === false);
await svc.from("organizations").update({ show_driver_contact: akagera.show_driver_contact }).eq("id", akagera.id);

finish();
