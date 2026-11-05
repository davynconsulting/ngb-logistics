// Live: clients, users (invite → deactivate → reactivate), shipment registration (AC-01, AC-05)
// Creates fictional test data (one shipment, one client) per run; deletes the temporary invitee.
import { ANON, PW, URL_, check, checkDigit as cd, cn, createClient, finish, get as getAs, login, svc } from "./_shared.mjs";

console.log("— clients, users, shipment registration —");
const as = async (email) => (await login(email)).api;
const cookieFor = async (email) => (await login(email)).cookie;
const get = (path, cookie) => getAs(path, cookie ? { cookie } : undefined);
const stamp = Date.now().toString().slice(-6);
const serial = +stamp;
const BL = `TESTBLE2E${stamp}`;

// ---------- database: registration rules ----------
const doc = await as("doc.officer@ngb.example");
const { data: orgs } = await doc.from("organizations").select("id, client_code").in("client_code", ["AKAGERA", "KIVU"]);
const AK = orgs.find((o) => o.client_code === "AKAGERA").id;
const { data: port } = await doc.from("ports").select("id").eq("code", "TZDAR").single();

const shipment = {
  client_id: AK, bl_number: BL.toLowerCase() + " ", shipping_line: "Fictional Ocean Line", vessel_name: "MV TEST HORIZON",
  voyage_number: "e2e1", origin_port_id: port.id, destination_country: "rw", destination_city: "Kigali",
  cargo_description: "E2E test cargo (fictional)", package_count: "12", gross_weight_kg: "18450.50",
  planned_vessel_arrival: "2026-11-20T12:00:00Z",
};
const c1 = cn(serial), c2 = cn(serial + 1);
const r1 = await doc.rpc("register_shipment", { p_shipment: shipment,
  p_containers: [{ container_number: c1, size_type: "40HC", seal_number: "sl001" }, { container_number: c2, size_type: "20GP" }] });
check("doc officer registers shipment with 2 containers", !r1.error && /^NGB-2026-\d{5}$/.test(r1.data?.[0]?.shipment_reference ?? ""),
  r1.error?.message ?? r1.data?.[0]?.shipment_reference);
const newId = r1.data?.[0]?.shipment_id;

const { data: row } = await doc.from("shipments")
  .select("bl_number, voyage_number, destination_country, overall_status, assigned_ops_user_id, containers(container_number, seal_number), document_requirements(document_type)")
  .eq("id", newId).single();
const { data: me } = await doc.auth.getUser();
check("values normalised (BL/voyage/country upper, trimmed)", row.bl_number === BL && row.voyage_number === "E2E1" && row.destination_country === "RW");
check("new shipment starts as draft", row.overall_status === "draft");
check("responsible defaults to the registering user", row.assigned_ops_user_id === me.user.id);
check("2 containers saved, seal upper-cased", row.containers.length === 2 && row.containers.some((c) => c.seal_number === "SL001"));
check("3 default checklist items created", row.document_requirements.length === 3);

const dupBl = await doc.rpc("register_shipment", { p_shipment: { ...shipment, bl_number: BL },
  p_containers: [{ container_number: cn(serial + 2) }] });
check("same BL rejected (AC-01)", dupBl.error?.code === "23505", dupBl.error?.message);

const dupOpen = await doc.rpc("register_shipment", { p_shipment: { ...shipment, bl_number: BL + "X" },
  p_containers: [{ container_number: c1 }] });
check("container already on open shipment rejected", dupOpen.error?.code === "23505" && /open shipment/.test(dupOpen.error.message), dupOpen.error?.message);

const dupTwice = await doc.rpc("register_shipment", { p_shipment: { ...shipment, bl_number: BL + "Y" },
  p_containers: [{ container_number: cn(serial + 3) }, { container_number: cn(serial + 3).toLowerCase() }] });
check("same container twice in one registration rejected", dupTwice.error?.code === "23505" && /twice/.test(dupTwice.error.message), dupTwice.error?.message);

const bad = cn(serial + 4).slice(0, 10) + ((cd(cn(serial + 4)) + 1) % 10);
const badCd = await doc.rpc("register_shipment", { p_shipment: { ...shipment, bl_number: BL + "Z" }, p_containers: [{ container_number: bad }] });
check("wrong ISO 6346 check digit rejected by DB", !!badCd.error, badCd.error?.code);
const { count: leftover } = await svc.from("shipments").select("id", { count: "exact", head: true }).in("bl_number", [BL + "X", BL + "Y", BL + "Z"]);
check("failed registrations leave nothing behind (atomic)", leftover === 0, `rows=${leftover}`);

const noCont = await doc.rpc("register_shipment", { p_shipment: { ...shipment, bl_number: BL + "W" }, p_containers: [] });
check("registration without containers rejected", noCont.error?.code === "22023");

// ---------- database: permissions & isolation ----------
const aline = await as("aline@akagera.example");
const cl = await aline.rpc("register_shipment", { p_shipment: { ...shipment, bl_number: BL + "C" }, p_containers: [{ container_number: cn(serial + 5) }] });
check("client cannot register shipments", cl.error?.code === "42501");
const agent = await as("clearing.agent@ngb.example");
const ag = await agent.rpc("register_shipment", { p_shipment: { ...shipment, bl_number: BL + "A" }, p_containers: [{ container_number: cn(serial + 6) }] });
check("clearing agent cannot register shipments", ag.error?.code === "42501");
const fin = await as("finance@ngb.example");
const fi = await fin.rpc("register_shipment", { p_shipment: { ...shipment, bl_number: BL + "F" }, p_containers: [{ container_number: cn(serial + 7) }] });
check("finance cannot register shipments", fi.error?.code === "42501");

const { data: alineSees } = await aline.from("shipments").select("id").eq("id", newId);
check("owning client (Akagera) can see the new shipment", alineSees?.length === 1);
const jean = await as("jean@kivuhardware.example");
const { data: jeanSees } = await jean.from("shipments").select("id").eq("id", newId);
check("other client (Kivu) cannot see it (AC-05)", jeanSees?.length === 0);
const { data: jeanProfiles } = await jean.from("profiles").select("email, organization_id");
check("client sees only own-org profiles/emails", jeanProfiles.every((p) => p.organization_id !== AK) && jeanProfiles.length > 0, `${jeanProfiles.length} rows`);
const statusHack = await aline.from("shipments").update({ overall_status: "delivered" }).eq("id", newId).select();
check("client cannot change status directly", !!statusHack.error || statusHack.data?.length === 0, statusHack.error?.code);
const docHack = await doc.from("shipments").update({ overall_status: "delivered" }).eq("id", newId).select();
check("staff cannot change status directly either", !!docHack.error, docHack.error?.code);
const { data: audit } = await svc.from("audit_log").select("action").eq("record_id", newId);
check("registration written to audit log", (audit?.length ?? 0) >= 1, `${audit?.length} entries`);

// ---------- clients: who can create ----------
const ops = await as("ops.manager@ngb.example");
const code = `E2E${stamp}`;
const newOrg = await ops.from("organizations").insert({ client_code: code, legal_name: `E2E Test Imports ${stamp} (TEST)`,
  preferred_language: "en", timezone: "Africa/Kigali", primary_contact_name: "E2E Contact", phone_e164: "+250000000199", credit_limit: "1234567.89", credit_currency: "USD" }).select("id").single();
check("ops manager can create a client", !newOrg.error, newOrg.error?.message);
const dupOrg = await ops.from("organizations").insert({ client_code: code, legal_name: "dup", primary_contact_name: "x", phone_e164: "+250000000198" });
check("duplicate client code rejected", dupOrg.error?.code === "23505");
const docOrg = await doc.from("organizations").insert({ client_code: code + "D", legal_name: "x" });
check("doc officer cannot create clients", !!docOrg.error, docOrg.error?.code);
const clientOrg = await aline.from("organizations").insert({ client_code: code + "C", legal_name: "x" });
check("client cannot create clients", !!clientOrg.error, clientOrg.error?.code);
const { data: cl2 } = await ops.from("organizations").select("credit_limit").eq("id", newOrg.data?.id).single();
check("credit limit stored exactly", String(cl2?.credit_limit) === "1234567.89", String(cl2?.credit_limit));
const opsEdit = await ops.from("organizations").update({ primary_contact_name: "E2E Contact" }).eq("id", newOrg.data.id).select("id");
check("ops manager can edit the client", opsEdit.data?.length === 1);

// ---------- invite -> link -> deactivate -> reactivate (same steps as lib/actions/users.ts) ----------
const inviteEmail = `e2e.invite.${stamp}@akagera.example`;
const link = await svc.auth.admin.generateLink({ type: "invite", email: inviteEmail });
check("invite link generated", !link.error && !!link.data?.properties?.hashed_token, link.error?.message);
const uid = link.data.user.id;
const upd = await svc.auth.admin.updateUserById(uid, { app_metadata: { role: "client", organization_id: AK, full_name: "E2E Invitee" } });
check("role + organization stored in app_metadata", !upd.error, upd.error?.message);
const { data: prof } = await svc.from("profiles").select("role, organization_id, email, is_active").eq("id", uid).single();
check("profile created by trigger with email", prof?.role === "client" && prof.organization_id === AK && prof.email === inviteEmail);

const cb = await get(`/auth/callback?token_hash=${link.data.properties.hashed_token}&type=invite&next=/update-password`);
check("invite link signs in and lands on /update-password", cb.status === 307 && cb.headers.get("location")?.endsWith("/update-password")
  && (cb.headers.get("set-cookie") ?? "").includes("auth-token"), `${cb.status} → ${cb.headers.get("location")}`);
const reuse = await get(`/auth/callback?token_hash=${link.data.properties.hashed_token}&type=invite&next=/update-password`);
check("invite link works only once", !reuse.headers.get("location")?.endsWith("/update-password"), reuse.headers.get("location"));

await svc.auth.admin.updateUserById(uid, { password: PW });
await svc.from("profiles").update({ is_active: false }).eq("id", uid);
await svc.auth.admin.updateUserById(uid, { ban_duration: "876000h" });
const banned = await createClient(URL_, ANON, { auth: { persistSession: false } }).auth.signInWithPassword({ email: inviteEmail, password: PW });
check("deactivated user cannot sign in", !!banned.error, banned.error?.code);
await svc.from("profiles").update({ is_active: true }).eq("id", uid);
await svc.auth.admin.updateUserById(uid, { ban_duration: "none" });
const back = await createClient(URL_, ANON, { auth: { persistSession: false } }).auth.signInWithPassword({ email: inviteEmail, password: PW });
check("reactivated user can sign in again", !back.error, back.error?.message);
const selfPromote = await back.data.session && (await (async () => {
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email: inviteEmail, password: PW });
  return c.from("profiles").update({ role: "admin" }).eq("id", uid);
})());
check("invited client cannot promote themselves", !!selfPromote?.error, selfPromote?.error?.code);
const opsBan = await ops.from("profiles").update({ is_active: false }).eq("role", "admin").select("id");
check("ops manager cannot deactivate staff through the API", !!opsBan.error || opsBan.data?.length === 0, opsBan.error?.code);

// ---------- pages (production build on :3123) ----------
const adminC = await cookieFor("admin@ngb.example");
for (const p of ["/admin/shipments", "/admin/shipments/new", `/admin/shipments/${newId}`, "/admin/clients", "/admin/clients/new", `/admin/clients/${newOrg.data.id}`, "/admin/users", "/admin/users/new"]) {
  const r = await get(p, adminC); const html = await r.text();
  check(`admin GET ${p.replace(/[0-9a-f-]{36}/, ":id")} → 200`, r.status === 200 && !/Application error|digest/.test(html), r.status);
  if (p === `/admin/shipments/${newId}`) check("detail shows reference + both containers", html.includes(r1.data[0].shipment_reference) && html.includes(c1) && html.includes(c2));
  if (p === "/admin/users") check("user list shows emails", html.includes("aline@akagera.example"));
}
const s = await (await get(`/admin/shipments?q=${BL}`, adminC)).text();
check("search by BL finds the new shipment", s.includes(r1.data[0].shipment_reference));
const s2 = await (await get(`/admin/shipments?client=${orgs.find((o) => o.client_code === "KIVU").id}`, adminC)).text();
check("client filter (Kivu) excludes the Akagera shipment", !s2.includes(r1.data[0].shipment_reference) && s2.includes("Kivu"));
const nf = await (await get(`/admin/shipments/00000000-0000-0000-0000-000000000000`, adminC)).text();
check("unknown shipment id → not-found page (noindex)", /could not be found/i.test(nf) && nf.includes('content="noindex"'));

const docC = await cookieFor("doc.officer@ngb.example");
const du = await get("/admin/users", docC);
check("doc officer is redirected away from /admin/users", du.status === 307 || (await du.text()).includes("NEXT_REDIRECT"), du.status);
const dn = await get("/admin/shipments/new", docC);
check("doc officer can open the registration form", dn.status === 200);
const finC = await cookieFor("finance@ngb.example");
const fn = await get("/admin/shipments/new", finC); const fnHtml = await fn.text();
check("finance cannot open the registration form", fn.status === 307 || /NEXT_REDIRECT|\/admin"/.test(fnHtml) && !fnHtml.includes("Register shipment</button"), fn.status);
const agC = await cookieFor("clearing.agent@ngb.example");
const adHtml = await (await get(`/admin/shipments/${newId}`, agC)).text();
check("clearing agent (not assigned) gets not-found, no data leaked", /could not be found/i.test(adHtml) && !adHtml.includes(r1.data[0].shipment_reference) && !adHtml.includes(BL));
const alC = await cookieFor("aline@akagera.example");
const ap = await get("/admin/shipments", alC);
check("client is redirected out of /admin", ap.status === 307 && ap.headers.get("location")?.endsWith("/portal"), ap.headers.get("location"));

// ---------- cleanup of the temporary invitee ----------
const del = await svc.auth.admin.deleteUser(uid);
console.log(`cleanup invitee: ${del.error ? "kept (" + del.error.message + ")" : "deleted"}`);
console.log(`\nKept test data: shipment ${r1.data?.[0]?.shipment_reference} (${BL}), client ${code}`);
finish();
