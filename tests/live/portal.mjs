// Client portal against the dev project: what a client sees (and never sees), uploads, inbox, settings.
import { action, check, cn, createClient, finish, formAction, get, login, pageText, svc } from "./_shared.mjs";

console.log("Client portal:");
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const ahead = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const stamp = Date.now().toString().slice(-6);

const doc = await login("doc.officer@ngb.example");
const ops = await login("ops.manager@ngb.example");
const transport = await login("transport@ngb.example");
const aline = await login("aline@akagera.example");
const jean = await login("jean@kivuhardware.example");
const { data: akagera } = await svc.from("organizations").select("id, show_driver_contact").eq("client_code", "AKAGERA").single();
const { data: dar } = await svc.from("ports").select("id").eq("code", "TZDAR").single();
const { data: kgl } = await svc.from("routes").select("id").eq("code", "DAR-KGL").single();
const { data: alineP } = await svc.from("profiles").select("id").eq("email", "aline@akagera.example").single();

// ---- fixture: a shipment with client-visible and staff-only content ----
const SECRET = `INTERNAL-${stamp}`;
const reg = await doc.api.rpc("register_shipment", {
  p_shipment: { client_id: akagera.id, bl_number: `TESTBLPRT${stamp}`, origin_port_id: dar.id, destination_country: "RW",
    destination_city: "Kigali", cargo_description: "Portal test cargo: roofing sheets (fictional)" },
  p_containers: [{ container_number: cn(700000 + (+stamp % 100000)), size_type: "40HC" }] });
if (reg.error) throw new Error("fixture: " + reg.error.message);
const shipId = reg.data[0].shipment_id;
const { data: ship } = await svc.from("shipments").select("shipment_reference, assigned_ops_user_id, containers(id, container_number)").eq("id", shipId).single();
const REF = ship.shipment_reference, c1 = ship.containers[0].id;
const adminPage = `/admin/shipments/${shipId}`;
// register_shipment created the default checklist; ask for a signed invoice with a due date
const req = await doc.api.from("document_requirements").update({ client_note: "Signed copy please", due_date: ahead(72).slice(0, 10), is_required: true, status: "missing" })
  .eq("shipment_id", shipId).eq("document_type", "commercial_invoice").select("id");
if (req.error || !req.data?.length) throw new Error("fixture requirement: " + (req.error?.message ?? "no commercial invoice item"));
const ms = async (who, m, extra = {}) => {
  const r = await who.api.rpc("record_milestone", { p_shipment_id: shipId, p_milestone: m, p_event_at: ago(4), ...extra });
  if (r.error) throw new Error(`fixture ${m}: ${r.error.message}`);
};
await ms(ops, "shipment_confirmed");
await ms(ops, "vessel_arrived", { p_location: "Dar es Salaam", p_public_note: "Berthed at TICTS" });
await ms(ops, "container_discharged", { p_container_ids: [c1], p_location: "TICTS" });
await ms(ops, "update", { p_public_note: `Staff only ${SECRET}`, p_internal_note: `Note ${SECRET}`, p_client_visible: false });
await ms(ops, "port_processing_started", { p_container_ids: [c1] });
await ms(ops, "ready_for_dispatch", { p_container_ids: [c1] });
await transport.api.rpc("revise_eta", { p_shipment_id: shipId, p_new_eta: ahead(80), p_reason_category: "schedule_confirmed", p_reason: "Loading planned tomorrow", p_client_visible: true });
await transport.api.rpc("revise_eta", { p_shipment_id: shipId, p_new_eta: ahead(82), p_reason_category: "truck_availability", p_reason: `Transporter penalty ${SECRET}`, p_client_visible: false });
const at = await transport.api.rpc("assign_transport", { p_shipment_id: shipId, p_container_ids: [c1], p_transporter_name: "Kagera Haulage (TEST)",
  p_truck_registration: `T ${stamp.slice(0, 3)} PRT`, p_driver_name: "Eric Niyonzima (TEST)", p_driver_phone: "+250788000333", p_route_id: kgl.id, p_planned_loading_at: ahead(20) });
if (at.error) throw new Error("fixture truck: " + at.error.message);
const assignmentId = at.data;
const ox = await ops.api.rpc("open_exception", { p_shipment_id: shipId, p_type: "customs_hold", p_title: "HS code query", p_severity: "medium",
  p_details: `Officer suspects undervaluation ${SECRET}`, p_owner_id: (await svc.from("profiles").select("id").eq("email", "ops.manager@ngb.example").single()).data.id });
if (ox.error) throw new Error("fixture exception: " + ox.error.message);
const exceptionId = ox.data;
console.log(`fixture: ${REF}`);

// ---- dashboard ----
const dash = await pageText(await get("/portal", aline));
check("dashboard lists the active shipment", dash.includes(REF));
check("…and the document the client must send", /Upload the commercial invoice/i.test(dash) && dash.includes("Signed copy please"));
check("portal has the mobile bottom navigation", (dash.match(/aria-label="Portal"/g) ?? []).length === 2);

// ---- staff publishes a client message on the exception ----
let r = await formAction(ops, "setExceptionClientMessage", [exceptionId, undefined],
  { client_message: "Customs asked about the cargo value; we are answering today.", client_visible: "on" }, adminPage);
check("ops publishes a client message on the exception", r.value?.ok === true, JSON.stringify(r.value));

// ---- shipment page ----
const page = await pageText(await get(`/portal/shipments/${REF}`, aline));
check("shipment page shows the timeline", page.includes("Vessel arrived") && page.includes("Berthed at TICTS"));
check("…the current ETA with its client-visible reason", page.includes("Loading planned tomorrow"));
check("…the truck, without the driver (policy off)", page.includes(`T ${stamp.slice(0, 3)} PRT`) && !page.includes("Eric Niyonzima"));
check("…the client message for the exception", page.includes("Customs asked about the cargo value"));
check("…the document checklist", /Commercial invoice/.test(page) && page.includes("Missing"));
check("nothing internal reaches the client (notes, hidden ETA reason, exception details)", !page.includes(SECRET), page.match(new RegExp(`.{40}${SECRET}.{20}`))?.[0]);
const apiRow = (await aline.api.from("shipments").select("eta_reason").eq("id", shipId).single()).data;
check("the hidden ETA reason is not on the client-readable shipment row (0019)", apiRow && !String(apiRow.eta_reason).includes(SECRET), JSON.stringify(apiRow));
const other = await pageText(await get(`/portal/shipments/${REF}`, jean));
check("another client gets 'not found' for this reference (AC-05)", /could not be found/i.test(other) && !other.includes("roofing sheets"));
const bogus = await pageText(await get(`/portal/shipments/NGB-1999-99999`, aline));
check("…same answer as a reference that doesn't exist", /could not be found/i.test(bogus));
check("staff are sent away from the portal", (await get(`/portal/shipments/${REF}`, ops)).status !== 200 || !(await pageText(await get(`/portal/shipments/${REF}`, ops))).includes("roofing sheets"));

// ---- driver contact needs the org policy AND the driver's agreement ----
await action(transport, "setDriverSharing", [assignmentId, true], adminPage);
check("driver agreed, but policy off → still hidden", !(await pageText(await get(`/portal/shipments/${REF}`, aline))).includes("Eric Niyonzima"));
await svc.from("organizations").update({ show_driver_contact: true }).eq("id", akagera.id);
check("policy on + driver agreed → client sees the driver contact", (await pageText(await get(`/portal/shipments/${REF}`, aline))).includes("+250788000333"));
await action(aline, "setDriverSharing", [assignmentId, false], `/portal/shipments/${REF}`);
check("a client cannot change the driver's consent", (await svc.from("driver_contacts").select("share_with_client").eq("assignment_id", assignmentId).single()).data.share_with_client === true);
await svc.from("organizations").update({ show_driver_contact: akagera.show_driver_contact }).eq("id", akagera.id);

// ---- client uploads the commercial invoice ----
const pdf = new Blob([`%PDF-1.4\n% portal test ${stamp}\n`], { type: "application/pdf" });
const input = { shipmentId: shipId, documentType: "commercial_invoice", fileName: "Invoice AK-2026-118.pdf", mimeType: "application/pdf", clientVisible: false, size: pdf.size };
const prep = (await action(aline, "prepareDocumentUpload", [input], `/portal/shipments/${REF}`)).value;
check("client gets an upload slot for its commercial invoice", prep?.ok === true, JSON.stringify(prep));
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const up = await anon.storage.from("shipment-documents").uploadToSignedUrl(prep.path, prep.token, pdf, { contentType: "application/pdf" });
const fin = (await action(aline, "finalizeDocumentUpload", [{ ...input, documentId: prep.documentId, path: prep.path }], `/portal/shipments/${REF}`)).value;
check("…uploads and records it", !up.error && fin?.ok === true, JSON.stringify(up.error ?? fin));
const { data: upDoc } = await svc.from("documents").select("verification_status, client_visible, uploaded_by").eq("id", prep.documentId).single();
check("…as pending review, visible to the client even though it asked otherwise", upDoc?.verification_status === "pending" && upDoc.client_visible === true && upDoc.uploaded_by === alineP.id, JSON.stringify(upDoc));
check("the shipment's ops owner is notified", ((await svc.from("notifications").select("id").eq("template_key", "staff.client_uploaded").eq("recipient_id", ship.assigned_ops_user_id).eq("shipment_id", shipId)).data ?? []).length === 1);
const wrongType = (await action(aline, "prepareDocumentUpload", [{ ...input, documentType: "release_order" }], `/portal/shipments/${REF}`)).value;
check("client cannot upload a release order", wrongType?.ok === false);
const otherShip = (await action(jean, "prepareDocumentUpload", [input], `/portal/shipments/${REF}`)).value;
check("another client cannot upload to this shipment", otherShip?.ok === false);

// ---- inbox ----
const inbox = (await aline.api.from("notifications").select("id, read_at, template_key").eq("shipment_id", shipId).order("created_at")).data ?? [];
check("client inbox has this shipment's updates", inbox.length >= 3 && inbox.every((n) => !n.template_key.startsWith("staff.")), JSON.stringify(inbox.map((n) => n.template_key)));
const first = inbox.find((n) => n.template_key === "milestone.vessel_arrived");
r = await action(aline, "openNotification", [first.id], "/portal/notifications");
check("opening a notification goes to the shipment", (r.redirect ?? "").startsWith(`/portal/shipments/${REF}`), r.redirect);
check("…and marks it read", !!(await svc.from("notifications").select("read_at").eq("id", first.id).single()).data.read_at);
const jeanNote = (await jean.api.from("notifications").select("id, read_at").is("read_at", null).limit(1)).data?.[0];
if (jeanNote) {
  r = await action(aline, "openNotification", [jeanNote.id], "/portal/notifications");
  // Next appends the navigation kind (";push") to redirect targets in action responses
  check("a client cannot open another client's notification", (r.redirect ?? "").replace(/;(push|replace)$/, "") === "/portal/notifications"
    && !(await svc.from("notifications").select("read_at").eq("id", jeanNote.id).single()).data.read_at, r.redirect);
}
await action(aline, "markAllRead", [], "/portal/notifications");
check("mark all read", ((await aline.api.from("notifications").select("id").is("read_at", null)).data ?? []).length === 0);
const inboxPage = await pageText(await get("/portal/notifications", aline));
check("inbox page renders the texts", inboxPage.includes(`${REF}: Vessel arrived`));

// ---- WhatsApp settings ----
r = await formAction(aline, "saveWhatsApp", [undefined], { whatsapp_opt_in: "on", whatsapp_phone: "0788123456", consent: "on" }, "/portal/settings");
check("WhatsApp: a number without country code is refused", !!r.value?.fieldErrors?.whatsapp_phone, JSON.stringify(r.value));
r = await formAction(aline, "saveWhatsApp", [undefined], { whatsapp_opt_in: "on", whatsapp_phone: "+250 788 000 902" }, "/portal/settings");
check("WhatsApp: consent is required", !!r.value?.fieldErrors?.consent, JSON.stringify(r.value));
r = await formAction(aline, "saveWhatsApp", [undefined], { whatsapp_opt_in: "on", whatsapp_phone: "+250 788 000 902", consent: "on" }, "/portal/settings");
let prefs = (await svc.from("notification_preferences").select("whatsapp_opt_in, whatsapp_phone, consent_at, consent_source").eq("user_id", alineP.id).single()).data;
check("WhatsApp: opted in with the normalised number and a consent record", r.value?.ok && prefs.whatsapp_opt_in && prefs.whatsapp_phone === "+250788000902"
  && prefs.consent_source === "portal" && Date.now() - new Date(prefs.consent_at) < 120e3, JSON.stringify(prefs));
check("settings page shows it masked", (await pageText(await get("/portal/settings", aline))).includes("+250788***902"));
r = await formAction(aline, "saveWhatsApp", [undefined], {}, "/portal/settings");
prefs = (await svc.from("notification_preferences").select("whatsapp_opt_in, whatsapp_phone").eq("user_id", alineP.id).single()).data;
check("WhatsApp: turning it off removes the number", r.value?.ok && !prefs.whatsapp_opt_in && prefs.whatsapp_phone === null, JSON.stringify(prefs));

// ---- staff hide the client message ----
r = await formAction(ops, "setExceptionClientMessage", [exceptionId, undefined], { client_message: "" }, adminPage);
check("ops hides the client message", r.value?.ok === true && !(await pageText(await get(`/portal/shipments/${REF}`, aline))).includes("Customs asked about the cargo value"));
r = await formAction(doc, "setExceptionClientMessage", [exceptionId, undefined], { client_message: "Hello there client", client_visible: "on" }, adminPage);
check("a non-owner cannot publish a client message", r.value?.ok !== true, JSON.stringify(r.value));

finish();
