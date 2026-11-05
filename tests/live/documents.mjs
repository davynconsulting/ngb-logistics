// Live: document upload / versions / review / download through the real server actions (AC-16)
// Registers one fictional test shipment per run and adds test documents to it.
import { ANON, BUCKET, URL_, action, check, createClient, finish, formAction, get, login, pageText, svc } from "./_shared.mjs";

console.log("— documents —");
const actionForm = (who, name, args, fields, page) =>
  formAction(who, name, args.map((x) => (x === "$undefined" ? undefined : x)), fields, page).then((r) => ({ status: r.status, value: r.value }));
const pdf = (label, pad = 0) => new Blob([`%PDF-1.4\n% NGB TEST ${label} (fictional)\n${"x".repeat(pad)}\n%%EOF\n`], { type: "application/pdf" });
const anonStorage = () => createClient(URL_, ANON, { auth: { persistSession: false } }).storage.from(BUCKET);

/** The browser's three steps. Returns { prep, up, fin }. */
async function uploadFlow(who, page, input, blob, contentType = "application/pdf", override = {}) {
  const prep = (await action(who, "prepareDocumentUpload", [{ ...input, size: input.size ?? blob.size }], page)).value;
  if (!prep?.ok) return { prep };
  const up = await anonStorage().uploadToSignedUrl(prep.path, prep.token, blob, { contentType });
  if (up.error) return { prep, up };
  const fin = (await action(who, "finalizeDocumentUpload", [{ ...input, documentId: prep.documentId, path: prep.path, ...override }], page)).value;
  return { prep, up, fin };
}

// ---- actors and fixtures ----
const doc = await login("doc.officer@ngb.example");
const admin = await login("admin@ngb.example");
const agent = await login("clearing.agent@ngb.example");
const finance = await login("finance@ngb.example");
const aline = await login("aline@akagera.example");
const jean = await login("jean@kivuhardware.example");

// Fresh, fictional test shipment for every run (registered by the doc officer through the real RPC)
const L = { A:10,B:12,C:13,D:14,E:15,F:16,G:17,H:18,I:19,J:20,K:21,L:23,M:24,N:25,O:26,P:27,Q:28,R:29,S:30,T:31,U:32,V:34,W:35,X:36,Y:37,Z:38 };
const cn = (n) => { const b = "NGBU" + String(n).padStart(6, "0"); let t = 0; for (let i = 0; i < 10; i++) t += (L[b[i]] ?? +b[i]) * 2 ** i; return b + ((t % 11) % 10); };
const stamp = Date.now().toString().slice(-6);
const { data: akagera } = await svc.from("organizations").select("id").eq("client_code", "AKAGERA").single();
const { data: dar } = await svc.from("ports").select("id").eq("code", "TZDAR").single();
const reg = await doc.api.rpc("register_shipment", {
  p_shipment: { client_id: akagera.id, bl_number: `TESTBLDOC${stamp}`, origin_port_id: dar.id, destination_country: "RW",
    destination_city: "Kigali", cargo_description: "Document workflow test cargo (fictional)" },
  p_containers: [{ container_number: cn(+stamp % 500000), size_type: "40HC" }] });
if (reg.error) throw new Error("fixture: " + reg.error.message);
const { data: ship } = await svc.from("shipments").select("id, client_id, shipment_reference, containers(id, container_number)")
  .eq("id", reg.data[0].shipment_id).single();
const page = `/admin/shipments/${ship.id}`;
const { data: agentProfile } = await svc.from("profiles").select("id").eq("email", "clearing.agent@ngb.example").single();
const { data: asg } = await svc.from("shipment_assignments").select("shipment_id").eq("user_id", agentProfile.id);
const assigned = asg.map((a) => a.shipment_id);
const { data: unassigned } = await svc.from("shipments").select("id, client_id").not("id", "in", `(${assigned.join(",")})`).limit(1).single();
const { data: assignedShip } = await svc.from("shipments").select("id, client_id").eq("id", assigned[0]).single();
console.log(`fixture: ${ship.shipment_reference}, agent assigned to ${assigned.length} shipments\n`);

const base = { shipmentId: ship.id, fileName: "Commercial Invoice (TEST).pdf", mimeType: "application/pdf", clientVisible: true, documentType: "commercial_invoice" };
const reqStatus = async (type, sid = ship.id) =>
  (await svc.from("document_requirements").select("status, client_note").eq("shipment_id", sid).eq("document_type", type).single()).data;

// ---------- upload (doc officer, real actions) ----------
const big = pdf("CI v1", 5000);
const u1 = await uploadFlow(doc, page, { ...base, size: 100 }, big); // claims 100 bytes, sends ~5 KB
check("prepare returns a signed token for a server-chosen path", u1.prep?.ok && u1.prep.path.startsWith(`${ship.client_id}/${ship.id}/${u1.prep.documentId}/`) && u1.prep.path.endsWith("/Commercial-Invoice-TEST.pdf"), u1.prep?.path?.split("/").pop());
check("browser upload to storage with the token succeeds", u1.up && !u1.up.error, u1.up?.error?.message);
check("finalize records version 1", u1.fin?.ok && u1.fin.version === 1, JSON.stringify(u1.fin));
const d1 = u1.prep.documentId;
const { data: row1 } = await svc.from("documents").select("size_bytes, mime_type, file_name, uploaded_by, verification_status").eq("id", d1).single();
const { data: docProfile } = await svc.from("profiles").select("id").eq("email", "doc.officer@ngb.example").single();
check("stored size is the real file size, not the claimed 100", row1.size_bytes === big.size, `${row1.size_bytes} bytes`);
check("original file name kept for display, uploader recorded", row1.file_name === "Commercial Invoice (TEST).pdf" && row1.uploaded_by === docProfile.id);
check("checklist: commercial invoice → received", (await reqStatus("commercial_invoice")).status === "received");

const tooBig = (await action(doc, "prepareDocumentUpload", [{ ...base, size: 21 * 1024 * 1024 }], page)).value;
check("prepare refuses files over 20 MB", tooBig?.ok === false && /20 MB/.test(tooBig.error), tooBig?.error);
const badType = (await action(doc, "prepareDocumentUpload", [{ ...base, mimeType: "text/html", size: 10 }], page)).value;
check("prepare refuses non-PDF/image types", badType?.ok === false, badType?.error);
const p2 = (await action(doc, "prepareDocumentUpload", [{ ...base, documentType: "packing_list", size: 10 }], page)).value;
const html = await anonStorage().uploadToSignedUrl(p2.path, p2.token, new Blob(["<script>alert(1)</script>"], { type: "text/html" }), { contentType: "text/html" });
check("bucket refuses an HTML file even with a valid token", !!html.error, html.error?.message?.slice(0, 50));
const noFile = (await action(doc, "finalizeDocumentUpload", [{ ...base, documentType: "packing_list", documentId: p2.documentId, path: p2.path }], page)).value;
check("finalize without a finished upload is refused", noFile?.ok === false && /didn't finish/.test(noFile.error), noFile?.error);
const p3 = (await action(doc, "prepareDocumentUpload", [{ ...base, size: 10 }], page)).value;
const tampered = (await action(doc, "finalizeDocumentUpload", [{ ...base, documentId: p3.documentId, path: `${unassigned.client_id}/${unassigned.id}/${p3.documentId}/x.pdf` }], page)).value;
check("finalize with a path for another shipment is refused", tampered?.ok === false, tampered?.error);
const wrongContainer = (await action(doc, "prepareDocumentUpload", [{ ...base, size: 10, containerId: "00000000-0000-4000-8000-000000000000" }], page)).value;
check("container must belong to the shipment", wrongContainer?.ok === false && /container/i.test(wrongContainer.error));

// ---------- review + versions ----------
const rej = await actionForm(doc, "reviewDocument", [d1, "$undefined"], { decision: "rejected", reason: "Amount does not match the BL (test)" }, page);
check("doc officer rejects v1 with a reason (real action)", rej.value?.ok === true, JSON.stringify(rej.value));
const ci = await reqStatus("commercial_invoice");
check("checklist → rejected, reason for the client", ci.status === "rejected" && ci.client_note === "Rejected: Amount does not match the BL (test)", JSON.stringify(ci));
const { data: shipRej } = await svc.from("shipments").select("doc_status").eq("id", ship.id).single();
check("shipment document status → rejected", shipRej.doc_status === "rejected", shipRej.doc_status);
const again = await actionForm(admin, "reviewDocument", [d1, "$undefined"], { decision: "verified" }, page);
check("already-reviewed document cannot be reviewed again", !!again.value?.error, again.value?.error);
const noReason = await actionForm(doc, "reviewDocument", [d1, "$undefined"], { decision: "rejected", reason: "" }, page);
check("rejection without reason refused by validation", !!noReason.value?.fieldErrors?.reason);
const finRev = await actionForm(finance, "reviewDocument", [d1, "$undefined"], { decision: "verified" }, page);
check("finance cannot review (redirected away)", finRev.value?.ok !== true && !(await svc.from("documents").select("verification_status").eq("id", d1).single()).data.verification_status.includes("verified"));

const u2 = await uploadFlow(doc, page, { ...base, fileName: "CI corrected.pdf", replacesId: d1 }, pdf("CI v2"));
check("new version uploaded → version 2", u2.fin?.ok && u2.fin.version === 2, JSON.stringify(u2.fin ?? u2.prep));
const d2 = u2.prep.documentId;
const ci2 = await reqStatus("commercial_invoice");
check("checklist back to received, rejection note cleared", ci2.status === "received" && ci2.client_note === null, JSON.stringify(ci2));
const dupV = (await action(doc, "prepareDocumentUpload", [{ ...base, size: 10, replacesId: d1 }], page)).value;
check("cannot start a second v2 of the same v1", dupV?.ok === false && /newer version/.test(dupV.error), dupV?.error);
const ver = await actionForm(doc, "reviewDocument", [d2, "$undefined"], { decision: "verified" }, page);
check("doc officer verifies v2", ver.value?.ok === true);
check("checklist → complete", (await reqStatus("commercial_invoice")).status === "complete");
const { data: v2row } = await svc.from("documents").select("verified_by, verified_at").eq("id", d2).single();
check("reviewer and time recorded", v2row.verified_by === docProfile.id && !!v2row.verified_at);
const direct = await doc.api.from("documents").update({ verification_status: "verified" }).eq("id", p2.documentId);
check("verification cannot be written directly through the API", !!direct.error, direct.error?.code);
const { data: aud } = await svc.from("audit_log").select("action, actor_id").eq("table_name", "documents").eq("record_id", d2);
check("upload and review are in the audit trail with the actor", aud.some((a) => a.action === "INSERT" && a.actor_id === docProfile.id) && aud.some((a) => a.action === "UPDATE"), aud.map((a) => a.action).join(","));

// ---------- downloads (AC-16) ----------
const r1 = await get(`/documents/${d2}`, doc);
const signed = r1.headers.get("location") ?? "";
check("staff: /documents/{id} → 303 to a short-lived signed URL", r1.status === 303 && signed.startsWith(URL_) && /token=/.test(signed), r1.status);
check("response is private, no-store", (r1.headers.get("cache-control") ?? "").includes("no-store"));
const file = await fetch(signed);
check("signed URL serves the PDF", file.status === 200 && file.headers.get("content-type") === "application/pdf" && (await file.text()).includes("NGB TEST CI v2"));
const r2 = await get(`/documents/${d2}?download=1`, doc);
const dl = await fetch(r2.headers.get("location"));
check("?download=1 → attachment with the original file name", /attachment/.test(dl.headers.get("content-disposition") ?? "") && /CI corrected\.pdf/.test(decodeURIComponent(dl.headers.get("content-disposition") ?? "")), dl.headers.get("content-disposition"));
const own = await get(`/documents/${d2}`, aline);
check("owning client can open its client-visible document", own.status === 303);
const other = await get(`/documents/${d2}`, jean);
check("other client gets 404 (guessed link)", other.status === 404, other.status);
const anon = await get(`/documents/${d2}`);
check("signed-out → login, then back to the document", anon.status === 303 && anon.headers.get("location")?.includes(`/login?next=%2Fdocuments%2F${d2}`), anon.headers.get("location"));
check("unknown id → 404", (await get(`/documents/00000000-0000-4000-8000-000000000000`, admin)).status === 404);
check("malformed id → 404", (await get(`/documents/..%2F..%2Fadmin`, admin)).status === 404);

await action(doc, "setDocumentVisibility", [d2, false], page);
const { data: hid } = await svc.from("documents").select("client_visible").eq("id", d2).single();
check("doc officer hides the document from the client (real action)", hid.client_visible === false);
check("hidden document → 404 for the client", (await get(`/documents/${d2}`, aline)).status === 404);
check("…staff can still open it", (await get(`/documents/${d2}`, doc)).status === 303);
await action(finance, "setDocumentVisibility", [d2, true], page);
check("finance cannot change visibility", (await svc.from("documents").select("client_visible").eq("id", d2).single()).data.client_visible === false);
await action(doc, "setDocumentVisibility", [d2, true], page);

const { data: kivuOrg } = await svc.from("organizations").select("id").eq("client_code", "KIVU").single();
const { data: kivuDoc } = await svc.from("documents").select("storage_path, shipments!inner(client_id)").eq("shipments.client_id", kivuOrg.id).limit(1).single();
check("fixture really is a Kivu file", kivuDoc.storage_path.startsWith(kivuOrg.id + "/"));
const guessSigned = await aline.api.storage.from(BUCKET).createSignedUrl(kivuDoc.storage_path, 60);
check("client cannot sign another client's file path directly", !!guessSigned.error, guessSigned.error?.message?.slice(0, 40));
const pub = await fetch(`${URL_}/storage/v1/object/public/${BUCKET}/${kivuDoc.storage_path}`);
check("public URL for the bucket does not work (private bucket)", pub.status >= 400, pub.status);
const authd = await fetch(`${URL_}/storage/v1/object/authenticated/${BUCKET}/${kivuDoc.storage_path}`, { headers: { apikey: ANON, Authorization: `Bearer ${(await aline.api.auth.getSession()).data.session.access_token}` } });
check("client's own token cannot fetch another client's file", authd.status >= 400, authd.status);

// ---------- who can upload what ----------
const agentPage = `/admin/shipments/${assignedShip.id}`;
const ag1 = (await action(agent, "prepareDocumentUpload", [{ ...base, shipmentId: assignedShip.id, size: 10 }], agentPage)).value;
check("agent cannot upload a commercial invoice", ag1?.ok === false && /can't upload/.test(ag1.error), ag1?.error);
const ag2 = (await action(agent, "prepareDocumentUpload", [{ ...base, documentType: "customs_entry", shipmentId: unassigned.id, size: 10 }], agentPage)).value;
check("agent cannot upload to an unassigned shipment", ag2?.ok === false, ag2?.error);
const ag3 = await uploadFlow(agent, agentPage, { ...base, documentType: "customs_entry", shipmentId: assignedShip.id, fileName: "customs entry.pdf", clientVisible: false }, pdf("customs"));
check("agent uploads a customs entry to an assigned shipment", ag3.fin?.ok === true, JSON.stringify(ag3.fin ?? ag3.prep ?? ag3.up?.error));
const direct1 = await agent.api.storage.from(BUCKET).createSignedUploadUrl(`${unassigned.client_id}/${unassigned.id}/${crypto.randomUUID()}/x.pdf`);
check("agent cannot get an upload token for an unassigned shipment directly", !!direct1.error, direct1.error?.message?.slice(0, 40));
const direct2 = await aline.api.storage.from(BUCKET).createSignedUploadUrl(`${ship.client_id}/${ship.id}/${crypto.randomUUID()}/x.pdf`);
check("client can get an upload token for its own shipment (0015: commercial documents)", !direct2.error, direct2.error?.message?.slice(0, 60));
const direct3 = await aline.api.storage.from(BUCKET).upload(`${crypto.randomUUID()}/${ship.id}/${crypto.randomUUID()}/x.pdf`, pdf("x"), { contentType: "application/pdf" });
check("client cannot upload into another organization's folder", !!direct3.error, direct3.error?.message?.slice(0, 40));
const clientAct = await action(aline, "prepareDocumentUpload", [{ ...base, size: 10 }], page);
check("client calling the upload action is turned away", clientAct.value?.ok !== true, clientAct.status);
const finAct = (await action(finance, "prepareDocumentUpload", [{ ...base, size: 10 }], page)).value;
check("finance cannot upload", finAct?.ok === false, finAct?.error);
const ow = await anonStorage().uploadToSignedUrl(u1.prep.path, u1.prep.token, pdf("overwrite attempt"), { contentType: "application/pdf" });
check("a used token cannot overwrite the stored file", !!ow.error, ow.error?.message?.slice(0, 40));

// ---------- pages ----------
const docHtml = await pageText(await get(page, doc));
check("detail page shows documents, versions and upload form", docHtml.includes("CI corrected.pdf") && docHtml.includes("Earlier versions (1)") && docHtml.includes("Upload a document"));
check("checklist shows Complete for the invoice and Upload links for missing items", docHtml.includes("Complete") && docHtml.includes("?upload=packing_list#upload"));
const pendHtml = await pageText(await get(agentPage, doc));
check("doc officer sees Verify on a pending document", pendHtml.includes("Verify"));
const agentHtml = await pageText(await get(agentPage, agent));
check("agent sees upload form but no Verify/Hide controls", agentHtml.includes("Upload a document") && !agentHtml.includes(">Verify<") && !agentHtml.includes("Hide from client"));
const finHtml = await pageText(await get(page, finance));
check("finance sees documents but no upload form", finHtml.includes("CI corrected.pdf") && !finHtml.includes("Upload a document"));
const preset = await pageText(await get(`${page}?upload=packing_list`, doc));
check("?upload=packing_list pre-selects the type", /<option value="packing_list" selected/.test(preset));

// ---------- expiry ----------
console.log("\nwaiting 65 s to confirm signed URLs expire…");
await new Promise((r) => setTimeout(r, 65000));
const expired = await fetch(signed);
check("signed URL stops working after 60 s", expired.status >= 400, expired.status);

console.log(`\nTest documents added to ${ship.shipment_reference} (new test shipment, BL TESTBLDOC${stamp}) and one customs entry on an agent shipment.`);
finish();
