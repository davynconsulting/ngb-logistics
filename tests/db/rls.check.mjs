// Database checks: applies every migration to an in-memory Postgres (PGlite)
// with minimal stand-ins for Supabase's auth/storage schemas, then exercises
// RLS isolation, privileges, RPCs and triggers as different roles.
//
//   npm run test:db            (no network, no Docker, touches no real database)
//
// The stand-ins mimic Supabase: auth.uid() reads request.jwt.claim.sub, and
// storage.objects carries metadata {size, mimetype}. Sprint 1 scope: identity,
// shipments/containers, documents + storage, audit, registration, documents
// workflow. Add a section here for every migration.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2] ?? "supabase/migrations";
const db = new PGlite();

const STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_app_meta_data jsonb not null default '{}',
  raw_user_meta_data jsonb not null default '{}',
  last_sign_in_at timestamptz
);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (
  id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id), name text, owner uuid,
  metadata jsonb
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema storage to authenticated, anon, service_role;
grant select, insert on storage.objects to authenticated;
grant execute on function storage.foldername(text) to authenticated;
`;

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log("  ✓", name); };
const bad = (name, detail) => { fail++; console.log("  ✗", name, "→", detail); };

async function as(uid, sql, params = []) {
  await db.exec("reset role");
  if (uid === "anon") {
    await db.exec("set role anon");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  } else if (uid) {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
    await db.exec("set role authenticated");
  } else {
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
  }
}
async function expectRows(name, uid, sql, n, params) {
  try {
    const r = await as(uid, sql, params);
    r.rows.length === n ? ok(name) : bad(name, `expected ${n} rows, got ${r.rows.length}`);
    return r;
  } catch (e) { bad(name, e.message); }
}
async function expectError(name, uid, sql, pattern, params) {
  try {
    await as(uid, sql, params);
    bad(name, "expected an error but it succeeded");
  } catch (e) {
    pattern.test(e.message) ? ok(`${name}  [${e.message.slice(0, 70)}]`) : bad(name, `wrong error: ${e.message}`);
  }
}
async function expectOk(name, uid, sql, params) {
  try { const r = await as(uid, sql, params); ok(name); return r; }
  catch (e) { bad(name, e.message); }
}

// ---------------------------------------------------------------------------
await db.exec(STUBS);
console.log("Applying migrations:");
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  try {
    await db.exec(fs.readFileSync(path.join(dir, f), "utf8"));
    ok(f);
  } catch (e) {
    bad(f, e.message);
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(1);
  }
}

console.log("\nIdentity & users:");
const ngb = (await db.query(`insert into organizations (client_code, legal_name, is_internal)
  values ('NGB', 'NGB LOGISTICS Ltd', true) returning id`)).rows[0].id;
const A = (await db.query(`insert into organizations (client_code, legal_name, primary_contact_name, phone_e164)
  values ('AKAGERA', 'Akagera Trading Ltd (fictional)', 'Aline Uwase', '+250788000001') returning id`)).rows[0].id;
const B = (await db.query(`insert into organizations (client_code, legal_name, primary_contact_name, phone_e164)
  values ('KIVU', 'Kivu Hardware Co (fictional)', 'Jean Habimana', '+250788000002') returning id`)).rows[0].id;

// Mirrors Supabase Auth admin createUser(): INSERT with provider info, then
// UPDATE app metadata (role/org) in the same transaction.
async function user(email, role, org) {
  await db.exec("begin");
  try {
    const r = await db.query(`insert into auth.users (email, raw_app_meta_data) values ($1, $2) returning id`,
      [email, JSON.stringify({ provider: "email", providers: ["email"] })]);
    const id = r.rows[0].id;
    await db.query(`update auth.users set raw_app_meta_data = raw_app_meta_data || $2::jsonb where id = $1`,
      [id, JSON.stringify({ role, organization_id: org, full_name: email.split("@")[0] })]);
    await db.exec("commit");
    return id;
  } catch (e) { await db.exec("rollback"); throw e; }
}
const admin = await user("admin@ngb.test", "admin", ngb);
const doc = await user("doc@ngb.test", "doc_officer", ngb);
const agent = await user("agent@ngb.test", "clearing_agent", ngb);
const finance = await user("finance@ngb.test", "finance", ngb);
const cA = await user("aline@akagera.test", "client", A);
const cB = await user("jean@kivu.test", "client", B);
await expectRows("auth trigger created 6 profiles + preferences", null,
  "select 1 from profiles p join notification_preferences n on n.user_id = p.id", 6);
const nobody = (await db.query("insert into auth.users (email, raw_user_meta_data) values ('x@x.test', '{\"role\":\"admin\"}') returning id")).rows[0].id;
await expectRows("user without app-metadata role gets no profile (user metadata is ignored)", null,
  "select 1 from profiles where id = $1", 0, [nobody]);
await expectError("role without organization is rejected", null,
  "update auth.users set raw_app_meta_data = '{\"role\":\"admin\"}' where id = $1", /both be set/, [nobody]);
await expectError("invalid role value is rejected", null,
  `update auth.users set raw_app_meta_data = '{"role":"superuser","organization_id":"${ngb}"}' where id = $1`, /Invalid role/, [nobody]);
await expectError("client user cannot be put in NGB org", null,
  `update auth.users set raw_app_meta_data = '{"role":"client","organization_id":"${ngb}"}' where id = $1`, /client organization/, [nobody]);
await expectError("staff user cannot be put in client org", null,
  `update auth.users set raw_app_meta_data = '{"role":"admin","organization_id":"${A}"}' where id = $1`, /NGB organization/, [nobody]);
await expectError("second internal org is rejected", null,
  "insert into organizations (client_code, legal_name, is_internal) values ('NGB2','x',true)", /duplicate key/);
await expectError("client org without contact is rejected", null,
  "insert into organizations (client_code, legal_name) values ('NOCONTACT','x')", /client_contact_required/);

console.log("\nShipments & containers:");
const dar = (await db.query("select id from ports where code = 'TZDAR'")).rows[0].id;
const insShip = `insert into shipments (client_id, origin_port_id, destination_country, destination_city, bl_number)
  values ($1, $2, 'RW', 'Kigali', $3) returning id, shipment_reference, overall_status, assigned_ops_user_id`;
const sA = (await expectOk("doc officer registers shipment for client A", doc, insShip, [A, dar, "MSCU-BL-001"]))?.rows[0];
const sB = (await expectOk("doc officer registers shipment for client B", doc, insShip, [B, dar, "MSCU-BL-002"]))?.rows[0];
/^NGB-\d{4}-00001$/.test(sA?.shipment_reference) && /^NGB-\d{4}-00002$/.test(sB?.shipment_reference)
  ? ok(`references generated in sequence (${sA.shipment_reference}, ${sB.shipment_reference})`)
  : bad("reference format/sequence", JSON.stringify([sA, sB]));
sA?.overall_status === "draft" && sA?.assigned_ops_user_id === doc ? ok("new shipment is draft, owned by creator") : bad("defaults", JSON.stringify(sA));
await expectError("duplicate shipment reference rejected (AC-01)", null,
  `insert into shipments (shipment_reference, client_id, origin_port_id, destination_country, destination_city, assigned_ops_user_id)
   values ($1, $2, $3, 'RW', 'Kigali', $4)`, /duplicate key/, [sA.shipment_reference, A, dar, doc]);
await expectError("shipment for the NGB org is rejected", doc, insShip, /client organization/, [ngb, dar, "x"]);
await expectError("client cannot create a shipment", cA, insShip, /row-level security|NGB staff/, [A, dar, "X"]);
await expectError("client cannot create a shipment even naming a real staff owner", cA,
  `insert into shipments (client_id, origin_port_id, destination_country, destination_city, assigned_ops_user_id)
   values ($1, $2, 'RW', 'Kigali', $3)`, /row-level security/, [A, dar, doc]);
await expectError("finance cannot create a shipment", finance, insShip, /row-level security/, [A, dar, "X"]);
await expectError("staff cannot set status directly (status changes go via RPC)", doc,
  "update shipments set overall_status = 'closed' where id = $1", /permission denied/, [sA.id]);
await expectError("staff cannot insert a shipment pre-set to 'delivered'", doc,
  `insert into shipments (client_id, origin_port_id, destination_country, destination_city, overall_status)
   values ($1, $2, 'RW', 'Kigali', 'delivered')`, /permission denied/, [A, dar]);
await expectError("reference cannot be changed", doc,
  "update shipments set shipment_reference = 'NGB-2026-99999' where id = $1", /permission denied/, [sA.id]);

const insCont = "insert into containers (shipment_id, container_number, size_type) values ($1, $2, '40HC') returning id";
await expectOk("valid ISO 6346 container accepted (CSQU3054383)", doc, insCont, [sA.id, "CSQU3054383"]);
await expectOk("second container on same shipment (AC-02)", doc, insCont, [sA.id, "ABCU0000003".replace(/.$/, String((() => {
  // compute check digit for ABCU000000 in JS to stay independent of SQL
  const v = (c) => { const b = c.charCodeAt(0) - 55; return b + Math.floor((b - 1) / 10); };
  let s = 0; const f = "ABCU000000"; for (let i = 0; i < 10; i++) s += (i < 4 ? v(f[i]) : +f[i]) * 2 ** i; return (s % 11) % 10;
})()))]);
await expectError("bad check digit rejected", doc, insCont, /is_valid_container_number|check constraint/, [sA.id, "CSQU3054384"]);
await expectError("same container twice on one shipment rejected", doc, insCont, /duplicate key/, [sA.id, "CSQU3054383"]);
await expectOk("container on client B shipment", doc, insCont, [sB.id, "CSQU3054383"]);

console.log("\nClient isolation (AC-05):");
await expectRows("client A sees only its own shipment", cA, "select id from shipments", 1);
await expectRows("client A gets nothing for client B's shipment id", cA, "select id from shipments where id = $1", 0, [sB.id]);
await expectRows("client A sees only its own containers", cA, "select id from containers", 2);
await expectRows("client A sees only its own organization", cA, "select id from organizations", 1);
await expectRows("client B sees only its own shipment", cB, "select id from shipments", 1);
await expectRows("client A cannot update B's shipment (0 rows)", cA,
  "update shipments set bl_number = 'HACK' where id = $1 returning id", 0, [sB.id]);
await expectError("anonymous visitor cannot read shipments", "anon", "select * from shipments", /permission denied/);
await expectError("client cannot change own role", cA, "update profiles set role = 'admin' where id = $1", /permission denied/, [cA]);
await expectOk("client can edit own name", cA, "update profiles set full_name = 'Aline U.' where id = $1", [cA]);

console.log("\nAssigned-only roles:");
await expectRows("clearing agent sees nothing before assignment", agent, "select id from shipments", 0);
await expectOk("admin assigns agent to client A shipment", admin,
  "insert into shipment_assignments (shipment_id, user_id) values ($1, $2)", [sA.id, agent]);
await expectRows("clearing agent now sees exactly that shipment", agent, "select id from shipments", 1);
await expectError("a client user cannot be assigned to a shipment", admin,
  "insert into shipment_assignments (shipment_id, user_id) values ($1, $2)", /clearing agents and drivers/, [sA.id, cA]);
await expectRows("finance sees all shipments", finance, "select id from shipments", 2);

console.log("\nDocuments & storage (AC-16):");
const docId1 = "11111111-1111-4111-8111-111111111111", docId2 = "22222222-2222-4222-8222-222222222222", docId3 = "33333333-3333-4333-8333-333333333333";
const insDoc = `insert into documents (id, shipment_id, document_type, storage_path, file_name, mime_type, size_bytes, client_visible)
  values ($1, $2, $3, $4, $5, 'application/pdf', 1000, $6)`;
const pA1 = `${A}/${sA.id}/${docId1}/bl.pdf`, pA2 = `${A}/${sA.id}/${docId2}/customs-notes.pdf`, pB1 = `${B}/${sB.id}/${docId3}/bl.pdf`;
const putFile = (p, size = 1000, mime = "application/pdf") =>
  db.query("insert into storage.objects (bucket_id, name, metadata) values ('shipment-documents', $1, $2)", [p, JSON.stringify({ size, mimetype: mime })]);
for (const p of [pA1, pA2, pB1]) await putFile(p);
await expectOk("doc officer uploads client-visible BL for A", doc, insDoc, [docId1, sA.id, "bill_of_lading", pA1, "bl.pdf", true]);
await expectOk("doc officer uploads internal-only doc for A", doc, insDoc, [docId2, sA.id, "customs_entry", pA2, "customs-notes.pdf", false]);
await expectOk("doc officer uploads BL for B", doc, insDoc, [docId3, sB.id, "bill_of_lading", pB1, "bl.pdf", true]);
await expectError("storage path pointing at another client is rejected", doc, insDoc, /storage_path/,
  ["44444444-4444-4444-8444-444444444444", sA.id, "other", `${B}/${sA.id}/44444444-4444-4444-8444-444444444444/x.pdf`, "x.pdf", true]);
await expectError("client cannot add a staff-only document type", cA, insDoc, /row-level security|not been uploaded/,
  ["55555555-5555-4555-8555-555555555555", sA.id, "customs_entry", `${A}/${sA.id}/55555555-5555-4555-8555-555555555555/x.pdf`, "x.pdf", true]);
await expectError("client cannot add a document to another client's shipment (no file hint)", cA, insDoc, /row-level security/,
  ["55555555-5555-4555-8555-555555555556", sB.id, "packing_list", `${B}/${sB.id}/55555555-5555-4555-8555-555555555556/x.pdf`, "x.pdf", true]);
await expectRows("client A sees only its client-visible document", cA, "select id from documents", 1);
await expectRows("staff sees both A documents", doc, "select id from documents where shipment_id = $1", 2, [sA.id]);
await expectRows("agent (assigned to A) sees A docs only", agent, "select id from documents", 2);
await expectError("documents cannot be deleted", admin, "delete from documents where id = $1", /permission denied/, [docId1]);

await expectRows("client A can read only its visible file in storage", cA, "select name from storage.objects", 1);
await expectRows("client A cannot read B's file by guessed path", cA, "select name from storage.objects where name = $1", 0, [pB1]);
await expectRows("client B cannot read A's files", cB, "select name from storage.objects where name like $1", 0, [`${A}/%`]);
await expectError("agent cannot upload into an unassigned shipment's folder", agent,
  "insert into storage.objects (bucket_id, name) values ('shipment-documents', $1)", /row-level security/, [`${B}/${sB.id}/x/y.pdf`]);
await expectOk("agent can upload into the assigned shipment's folder", agent,
  "insert into storage.objects (bucket_id, name) values ('shipment-documents', $1)", [`${A}/${sA.id}/66666666-6666-4666-8666-666666666666/pod.jpg`]);
await expectError("upload with mismatched client folder is rejected", doc,
  "insert into storage.objects (bucket_id, name) values ('shipment-documents', $1)", /row-level security/, [`${B}/${sA.id}/x/y.pdf`]);
await expectError("client cannot upload into another client's folder", cA,
  "insert into storage.objects (bucket_id, name) values ('shipment-documents', $1)", /row-level security/, [`${B}/${sB.id}/x/y.pdf`]);
await expectOk("doc officer verifies a document (review_document)", doc, "select review_document($1, 'verified')", [docId1]);
await expectError("verification cannot be written directly (no faked reviewer or time)", doc,
  "update documents set verification_status = 'verified', verified_by = $2, verified_at = now() where id = $1", /permission denied/, [docId3, admin]);

console.log("\nAudit trail:");
const audit = (await db.query("select table_name, action from audit_log")).rows;
audit.some((r) => r.table_name === "shipments" && r.action === "INSERT") && audit.some((r) => r.table_name === "documents" && r.action === "UPDATE")
  ? ok(`audit rows recorded (${audit.length} so far)`) : bad("audit rows", JSON.stringify(audit.slice(0, 5)));
const actorRow = (await db.query("select actor_id from audit_log where table_name='documents' and action='UPDATE' limit 1")).rows[0];
actorRow?.actor_id === doc ? ok("audit records who made the change") : bad("audit actor", JSON.stringify(actorRow));
await expectRows("client cannot read the audit log", cA, "select id from audit_log", 0);
await expectError("audit log cannot be updated — even by the superuser", null, "update audit_log set action = 'DELETE'", /append-only/);
await expectError("audit log cannot be deleted — even by the superuser", null, "delete from audit_log", /append-only/);
await expectError("users cannot write audit rows directly", admin,
  "insert into audit_log (table_name, action) values ('x', 'INSERT')", /permission denied/);

console.log("\nShipment registration RPC (0008):");
const reg = "select * from register_shipment($1::jsonb, $2::jsonb)";
const shipJson = (bl) => JSON.stringify({ client_id: A, origin_port_id: dar, destination_country: "rw", destination_city: " Kigali ", bl_number: bl, gross_weight_kg: "12500.50", package_count: "40", planned_vessel_arrival: "2026-12-01T08:00:00Z" });
const okReg = await expectOk("doc officer registers shipment with 2 containers in one call", doc, reg,
  [shipJson("testbl-900"), JSON.stringify([{ container_number: "msku1234565", size_type: "40HC" }, { container_number: "TGHU1234567" }])]);
const newId = okReg?.rows[0]?.shipment_id;
newId && /^NGB-/.test(okReg.rows[0].shipment_reference) ? ok("returns new id + reference " + okReg.rows[0].shipment_reference) : bad("rpc return", JSON.stringify(okReg?.rows));
await expectRows("containers saved (uppercased)", null, "select 1 from containers where shipment_id = $1 and container_number in ('MSKU1234565','TGHU1234567')", 2, [newId]);
await expectRows("default document checklist created (3 items)", null, "select 1 from document_requirements where shipment_id = $1", 3, [newId]);
await expectRows("BL normalized to upper case, status draft, owner = caller", null, "select 1 from shipments where id = $1 and bl_number = 'TESTBL-900' and overall_status = 'draft' and assigned_ops_user_id = $2 and destination_city = 'Kigali' and destination_country = 'RW'", 1, [newId, doc]);
await expectError("same BL again (any case) is rejected", doc, reg, /shipments_bl_number_unique|duplicate/, [shipJson("TestBL-900"), JSON.stringify([{ container_number: "TGHU0000008" }])]);
const before = (await db.query("select count(*)::int n from shipments")).rows[0].n;
await expectError("container already on an open shipment is rejected", doc, reg, /already on an open shipment/, [shipJson("TESTBL-901"), JSON.stringify([{ container_number: "MSKU1234565" }])]);
await expectError("same container twice in one form is rejected", doc, reg, /listed twice/, [shipJson("TESTBL-902"), JSON.stringify([{ container_number: "MSKU0000006" }, { container_number: "msku0000006" }])]);
await expectError("invalid container check digit → whole registration rolled back", doc, reg, /container_number_check|check constraint/, [shipJson("TESTBL-903"), JSON.stringify([{ container_number: "ABCU1111111" }])]);
const after = (await db.query("select count(*)::int n from shipments")).rows[0].n;
after === before ? ok("no half-saved shipments after failures (all-or-nothing)") : bad("atomicity", before + " → " + after);
await expectError("no containers → rejected", doc, reg, /at least one container/, [shipJson("TESTBL-904"), "[]"]);
await expectError("client cannot call register_shipment", cA, reg, /not allowed/, [shipJson("TESTBL-905"), JSON.stringify([{ container_number: "TGHU0000008" }])]);
await expectError("finance cannot call register_shipment", finance, reg, /not allowed/, [shipJson("TESTBL-906"), JSON.stringify([{ container_number: "TGHU0000008" }])]);
await expectError("anonymous cannot call register_shipment", "anon", reg, /permission denied/, [shipJson("TESTBL-907"), "[]"]);
const smug = await as(doc, reg, [JSON.stringify({ ...JSON.parse(shipJson("TESTBL-908")), overall_status: "closed", shipment_reference: "NGB-2026-99999" }), JSON.stringify([{ container_number: "TGHU0000008" }])]).catch(e=>({err:e.message}));
const smugRow = (await db.query("select overall_status, shipment_reference from shipments where bl_number = 'TESTBL-908'")).rows[0];
smugRow && smugRow.overall_status === "draft" && smugRow.shipment_reference !== "NGB-2026-99999" ? ok("extra payload fields (status, reference) are ignored") : bad("smuggle", JSON.stringify(smug) + JSON.stringify(smugRow));
await expectRows("profile email synced", null, "select 1 from profiles where email = 'doc@ngb.test'", 1);
await db.query("update auth.users set email = 'doc2@ngb.test' where id = $1", [doc]);
await expectRows("email change syncs to profile", null, "select 1 from profiles where id = $1 and email = 'doc2@ngb.test'", 1, [doc]);

console.log("\nDocument workflow (0009):");
const D = (n) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`;
const pth = (id, f) => `${A}/${sA.id}/${id}/${f}`;
const rec = "select * from record_document($1, $2, $3, $4, $5, $6, $7)";
await expectOk("checklist for A: BL + commercial invoice", doc,
  "insert into document_requirements (shipment_id, document_type) values ($1, 'bill_of_lading'), ($1, 'commercial_invoice')", [sA.id]);
await expectRows("BL item picks up the already-verified BL → complete", null,
  "select 1 from document_requirements where shipment_id = $1 and document_type = 'bill_of_lading' and status = 'complete'", 1, [sA.id]);
await expectRows("shipment doc status = missing (invoice not there yet)", null, "select 1 from shipments where id = $1 and doc_status = 'missing'", 1, [sA.id]);

await expectError("recording a file that was never uploaded is refused", doc, rec, /not been uploaded/,
  [D(7), sA.id, "commercial_invoice", pth(D(7), "ci.pdf"), "ci.pdf", null, null]);
await putFile(pth(D(7), "ci.pdf"), 48213, "application/pdf");
const v1 = await expectOk("doc officer records commercial invoice v1", doc, rec, [D(7), sA.id, "commercial_invoice", pth(D(7), "ci.pdf"), " CI March.pdf ", null, null]);
v1?.rows[0]?.version === 1 ? ok("version 1") : bad("v1", JSON.stringify(v1?.rows));
await expectRows("size and type come from storage (48213 bytes, pdf), name trimmed", null,
  "select 1 from documents where id = $1 and size_bytes = 48213 and mime_type = 'application/pdf' and file_name = 'CI March.pdf' and uploaded_by = $2", 1, [D(7), doc]);
await putFile(pth(D(6), "fake.pdf"), 999, "application/pdf");
await expectOk("direct insert with a false size…", doc,
  "insert into documents (id, shipment_id, document_type, storage_path, file_name, mime_type, size_bytes) values ($1, $2, 'other', $3, 'fake.pdf', 'image/png', 5)", [D(6), sA.id, pth(D(6), "fake.pdf")]);
await expectRows("…is corrected to the stored file's real size and type", null, "select 1 from documents where id = $1 and size_bytes = 999 and mime_type = 'application/pdf'", 1, [D(6)]);
await expectRows("checklist: invoice → received", null, "select 1 from document_requirements where shipment_id = $1 and document_type = 'commercial_invoice' and status = 'received'", 1, [sA.id]);
await expectRows("shipment doc status → received", null, "select 1 from shipments where id = $1 and doc_status = 'received'", 1, [sA.id]);

await putFile(pth(D(5), "x.pdf"));
await expectError("client cannot record staff-only document types", cA, rec, /row-level security/, [D(5), sA.id, "customs_entry", pth(D(5), "x.pdf"), "x.pdf", null, null]);
await expectError("assigned agent cannot record a commercial invoice", agent, rec, /row-level security/, [D(5), sA.id, "commercial_invoice", pth(D(5), "x.pdf"), "x.pdf", null, null]);
await expectOk("assigned agent can record a customs entry", agent, rec, [D(5), sA.id, "customs_entry", pth(D(5), "x.pdf"), "x.pdf", null, null]);
await expectOk("customs entry added to the checklist later…", doc, "insert into document_requirements (shipment_id, document_type, is_required) values ($1, 'customs_entry', false)", [sA.id]);
await expectRows("…starts as received (document already there)", null, "select 1 from document_requirements where shipment_id = $1 and document_type = 'customs_entry' and status = 'received'", 1, [sA.id]);

await putFile(pth(D(4), "ci-v2.pdf"));
const v2 = await expectOk("new version (v2) of the invoice", doc, rec, [D(4), sA.id, "commercial_invoice", pth(D(4), "ci-v2.pdf"), "ci-v2.pdf", null, D(7)]);
v2?.rows[0]?.version === 2 ? ok("numbered version 2") : bad("v2", JSON.stringify(v2?.rows));
await putFile(pth(D("d"), "ci-v2b.pdf"));
await expectError("a second v2 of the same v1 is refused (linear history)", doc, rec, /documents_replaced_once/,
  [D("d"), sA.id, "commercial_invoice", pth(D("d"), "ci-v2b.pdf"), "ci-v2b.pdf", null, D(7)]);
await expectError("a version must keep the same document type", doc, rec, /same document/,
  [D("d"), sA.id, "packing_list", pth(D("d"), "ci-v2b.pdf"), "ci-v2b.pdf", null, D(4)]);

await expectError("old version cannot be reviewed", doc, "select review_document($1, 'verified')", /newer version/, [D(7)]);
await expectError("rejection needs a reason", doc, "select review_document($1, 'rejected', '  ')", /reason/, [D(4)]);
await expectError("finance cannot review", finance, "select review_document($1, 'verified')", /not allowed/, [D(4)]);
await expectError("client cannot review", cA, "select review_document($1, 'verified')", /not allowed/, [D(4)]);
await expectOk("doc officer rejects v2 with a reason", doc, "select review_document($1, 'rejected', 'Amount does not match the BL')", [D(4)]);
await expectRows("checklist: rejected, reason shown to client", null,
  "select 1 from document_requirements where shipment_id = $1 and document_type = 'commercial_invoice' and status = 'rejected' and client_note = 'Rejected: Amount does not match the BL'", 1, [sA.id]);
await expectRows("shipment doc status → rejected", null, "select 1 from shipments where id = $1 and doc_status = 'rejected'", 1, [sA.id]);
await expectError("a reviewed document cannot be reviewed again", admin, "select review_document($1, 'verified')", /already been reviewed/, [D(4)]);

await putFile(pth(D("c"), "ci-v3.pdf"));
await expectOk("v3 uploaded after the rejection", doc, rec, [D("c"), sA.id, "commercial_invoice", pth(D("c"), "ci-v3.pdf"), "ci-v3.pdf", null, D(4)]);
await expectRows("checklist back to received, rejection note cleared", null,
  "select 1 from document_requirements where shipment_id = $1 and document_type = 'commercial_invoice' and status = 'received' and client_note is null", 1, [sA.id]);
await expectOk("admin verifies v3", admin, "select review_document($1, 'verified')", [D("c")]);
await expectRows("reviewer and time recorded", null, "select 1 from documents where id = $1 and verified_by = $2 and verified_at is not null", 1, [D("c"), admin]);
await expectRows("all required items complete → shipment doc status complete", null, "select 1 from shipments where id = $1 and doc_status = 'complete'", 1, [sA.id]);
await expectRows("review is in the audit trail", null, "select 1 from audit_log where table_name = 'documents' and record_id = $1 and action = 'UPDATE' and actor_id = $2", 1, [D("c"), admin]);

await expectRows("client A sees v3", cA, "select id from documents where id = $1", 1, [D("c")]);
await expectRows("doc staff can hide a document reviewed by someone else", doc, "update documents set client_visible = false where id = $1 returning id", 1, [D("c")]);
await expectRows("…and then client A no longer sees it", cA, "select id from documents where id = $1", 0, [D("c")]);
await expectRows("…nor its file", cA, "select name from storage.objects where name = $1", 0, [pth(D("c"), "ci-v3.pdf")]);
await expectRows("finance cannot change visibility", finance, "update documents set client_visible = true where id = $1 returning id", 0, [D("c")]);
await expectError("anonymous cannot record documents", "anon", rec, /permission denied/, [D(1), sA.id, "other", pth(D(1), "x.pdf"), "x.pdf", null, null]);

console.log("\nStatus engine (0010):");
const ops = await user("ops@ngb.test", "ops_manager", ngb);
const transport = await user("transport@ngb.test", "transport_coord", ngb);
const driver = await user("driver@ngb.test", "driver", ngb);
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const arr = (xs) => (xs ? `{${xs.join(",")}}` : null);
// record_milestone with named options
const MS = `select * from record_milestone($1::uuid, $2::milestone_type, $3::timestamptz, $4::uuid[], $5, $6::location_kind,
  $7, $8, $9::boolean, $10::uuid[], $11, $12, $13)`;
const msArgs = (ship, type, at, o = {}) => [ship, type, at, arr(o.containers), o.location ?? null, o.kind ?? null,
  o.note ?? null, o.internal ?? null, o.visible ?? null, arr(o.evidence), o.seal ?? null, o.override ?? null, o.key ?? null];
const ms = (name, uid, ship, type, at, o) => expectOk(name, uid, MS, msArgs(ship, type, at, o));
const msErr = (name, uid, ship, type, at, o, re) => expectError(name, uid, MS, re, msArgs(ship, type, at, o));
const statusOf = async (id) => (await db.query("select overall_status, customs_status, actual_vessel_arrival from shipments where id = $1", [id])).rows[0];
const contOf = async (id) => (await db.query("select * from containers where id = $1", [id])).rows[0];
const [c1, c2] = (await db.query("select id from containers where shipment_id = $1 order by container_number", [sA.id])).rows.map((r) => r.id);

await expectRows("catalogue readable by staff", doc, "select 1 from milestone_catalogue", 24);
await expectRows("catalogue readable by clients (labels)", cA, "select 1 from milestone_catalogue", 24);
await expectError("catalogue cannot be changed by admin", admin, "update milestone_catalogue set allowed_roles = '{client}'", /permission denied/);
await expectError("anonymous cannot record milestones", "anon", MS, /permission denied/, msArgs(sA.id, "shipment_confirmed", ago(1)));
await expectError("nobody can insert events directly", admin,
  "insert into milestone_events (shipment_id, batch_id, milestone_type, event_at) values ($1, gen_random_uuid(), 'delivered', now())", /permission denied/, [sA.id]);
await expectError("internal status helper is not callable", admin, "select private.refresh_shipment_status($1)", /permission denied/, [sA.id]);

await msErr("client cannot record milestones", cA, sA.id, "shipment_confirmed", ago(1), {}, /not allowed/);
await msErr("finance cannot record milestones", finance, sA.id, "shipment_confirmed", ago(1), {}, /not allowed|cannot record/);
await msErr("clearing agent cannot confirm a shipment (role matrix)", agent, sA.id, "shipment_confirmed", ago(1), {}, /cannot record/);
await msErr("milestones need a confirmed shipment", agent, sA.id, "vessel_arrived", ago(1), { location: "Dar es Salaam" }, /Confirm the shipment/);
await msErr("event time in the future is rejected", doc, sA.id, "shipment_confirmed", new Date(Date.now() + 3600e3).toISOString(), {}, /future/);
await ms("doc officer confirms shipment A", doc, sA.id, "shipment_confirmed", ago(100));
(await statusOf(sA.id)).overall_status === "registered" ? ok("documents complete → shipment registered") : bad("confirm", JSON.stringify(await statusOf(sA.id)));
await expectRows("client A sees the confirmation (client timeline)", cA, "select 1 from client_timeline($1)", 1, [sA.id]);
await expectRows("client cannot read milestone_events directly (internal reasons)", cA, "select 1 from milestone_events", 0);
await expectRows("client B does not (AC-05)", cB, "select 1 from milestone_events", 0);
await msErr("confirming twice is not a valid transition", doc, sA.id, "shipment_confirmed", ago(99), {}, /Not allowed now/);

await msErr("vessel arrival needs a location", agent, sA.id, "vessel_arrived", ago(90), {}, /location/);
await msErr("agent cannot record on an unassigned shipment", agent, sB.id, "vessel_arrived", ago(90), { location: "Dar es Salaam" }, /not found/);
await ms("assigned clearing agent records vessel arrival", agent, sA.id, "vessel_arrived", ago(90), { location: "Dar es Salaam port" });
let st = await statusOf(sA.id);
st.overall_status === "vessel_arrived" && st.actual_vessel_arrival ? ok("vessel arrival moves every container + sets actual arrival") : bad("vessel", JSON.stringify(st));

await ms("agent discharges container 1 only", agent, sA.id, "container_discharged", ago(80), { containers: [c1], location: "TICTS terminal", kind: "terminal" });
const k1 = await contOf(c1), k2 = await contOf(c2);
k1.operational_status === "container_discharged" && k1.discharge_at && k2.operational_status === "vessel_arrived"
  ? ok("containers move independently (AC-02)") : bad("per container", JSON.stringify([k1.operational_status, k2.operational_status]));
(await statusOf(sA.id)).overall_status === "vessel_arrived" ? ok("overall status = least-advanced container") : bad("overall", (await statusOf(sA.id)).overall_status);
await msErr("container 2 cannot skip discharge", agent, sA.id, "port_processing_started", ago(79), { containers: [c2] }, /Not allowed now.*vessel_arrived/);
await msErr("agent cannot override the workflow", agent, sA.id, "port_processing_started", ago(79), { containers: [c2], override: "urgent" }, /Only an operations manager/);
await msErr("a milestone cannot move a container backwards", agent, sA.id, "container_discharged", ago(79), { containers: [c1], location: "x" }, /use a correction/);
await msErr("a container of another shipment is rejected", agent, sA.id, "container_discharged", ago(79),
  { containers: [(await db.query("select id from containers where shipment_id = $1", [sB.id])).rows[0].id], location: "x" }, /not on this shipment/);

const r1 = await ms("discharge container 2 with an idempotency key", agent, sA.id, "container_discharged", ago(78), { containers: [c2], location: "TICTS", key: "tap-123" });
const r2 = await ms("…the same request again (retry)", agent, sA.id, "container_discharged", ago(78), { containers: [c2], location: "TICTS", key: "tap-123" });
r1?.rows[0]?.event_id && r1.rows[0].event_id === r2?.rows[0]?.event_id ? ok("retry returns the original event, nothing recorded twice") : bad("idempotency", JSON.stringify([r1?.rows, r2?.rows]));
await expectRows("one event for that key", null, "select 1 from milestone_events where idempotency_key = 'tap-123'", 1);

await ms("port processing (both containers)", agent, sA.id, "port_processing_started", ago(70), { containers: [c1, c2] });
await ms("ready for dispatch (both)", agent, sA.id, "ready_for_dispatch", ago(60), { containers: [c1, c2] });
await msErr("agent cannot assign trucks (role matrix)", agent, sA.id, "truck_assigned", ago(59), { containers: [c1] }, /cannot record/);
// trucks are assigned through assign_transport (0012), which records the "Truck assigned" milestone
const AT = "select assign_transport($1::uuid, $2::uuid[], $3, $4, $5, $6, $7, $8::uuid, $9::uuid, $10, $11::timestamptz, $12::text[], $13) id";
const atArgs = (ship, conts, o = {}) => [ship, arr(conts), o.carrier ?? "Kagera Haulage Ltd (fictional)", o.truck ?? "T 123 ABC",
  o.trailer ?? null, o.driverName ?? null, o.phone ?? null, o.driverUser ?? null, o.route ?? null, o.border ?? null,
  o.planned ?? null, o.refs ? `{${o.refs.map((r) => JSON.stringify(r)).join(",")}}` : null, o.override ?? null];
await expectOk("transport coordinator assigns a truck to both containers", transport, AT, atArgs(sA.id, [c1, c2]));
(await contOf(c1)).operational_status === "truck_assigned" && (await contOf(c2)).transport_status === "assigned"
  ? ok("…which records the truck-assigned milestone for each") : bad("truck milestone", (await contOf(c1)).operational_status);
await ms("loaded, with seal number", transport, sA.id, "loaded", ago(40), { containers: [c1, c2], seal: " ngb-seal-01 " });
(await contOf(c1)).seal_number === "NGB-SEAL-01" && (await contOf(c1)).transport_status === "loaded" ? ok("seal and transport status updated") : bad("seal", JSON.stringify(await contOf(c1)));
await msErr("gate-out before customs release is blocked", transport, sA.id, "gate_out", ago(30), { containers: [c1], location: "Dar ICD" }, /customs is not released/);
await msErr("transport cannot record customs (role matrix)", transport, sA.id, "customs_released", ago(30), {}, /cannot record/);
const ovr = await ms("ops manager overrides gate-out for container 2, with a reason", ops, sA.id, "gate_out", ago(30),
  { containers: [c2], location: "Dar ICD", override: "Release confirmed by phone; paper copy to follow" });
await expectRows("override is flagged with its reason", null, "select 1 from milestone_events where id = $1 and is_override and override_reason like 'Release%'", 1, [ovr?.rows[0]?.event_id]);
await msErr("customs release cannot skip submission", agent, sA.id, "customs_released", ago(29), {}, /Not allowed now.*customs is not_started/);
await ms("customs: entry in preparation", agent, sA.id, "customs_entry_prepared", ago(28));
await ms("customs: submitted", agent, sA.id, "customs_submitted", ago(27));
await ms("customs: released", agent, sA.id, "customs_released", ago(26));
(await statusOf(sA.id)).customs_status === "released" ? ok("customs track updated") : bad("customs", JSON.stringify(await statusOf(sA.id)));
await ms("gate-out for container 1 after release", transport, sA.id, "gate_out", ago(25), { containers: [c1], location: "Dar ICD" });
(await contOf(c1)).location_kind === "in_transit" && (await contOf(c1)).gate_out_at ? ok("gate-out sets in-transit + gate-out time") : bad("gate out", JSON.stringify(await contOf(c1)));
(await statusOf(sA.id)).overall_status === "in_transit" ? ok("shipment in transit") : bad("overall", (await statusOf(sA.id)).overall_status);

await msErr("unassigned driver cannot record", driver, sA.id, "arrived", ago(5), { containers: [c1] }, /not found/);
await db.query("insert into shipment_assignments (shipment_id, user_id) values ($1, $2)", [sA.id, driver]);
await msErr("a shipment_assignments row alone no longer gives a driver access (0020)", driver, sA.id, "arrived_at_border", ago(10), { containers: [c1], location: "Rusumo" }, /not found/);
// drivers work through their truck assignment (0020): put the driver on the truck carrying both containers
await db.query("update transport_assignments set driver_user_id = $2 where shipment_id = $1 and status = 'active'", [sA.id, driver]);
await msErr("driver cannot record port milestones", driver, sA.id, "ready_for_dispatch", ago(5), { containers: [c1] }, /cannot record/);
await ms("driver records a border checkpoint", driver, sA.id, "arrived_at_border", ago(10), { containers: [c1], location: "Rusumo" });
await ms("driver records arrival", driver, sA.id, "arrived", ago(5), { containers: [c1], internal: "Gate guard asked for extra copy", visible: true });
await expectRows("driver events are marked as driver source", null, "select 1 from milestone_events where source = 'driver'", 2);
await expectRows("staff see the internal note", ops, "select 1 from milestone_internal_notes where shipment_id = $1", 1, [sA.id]);
await expectRows("client sees no internal notes", cA, "select 1 from milestone_internal_notes", 0);
await ms("hidden update for staff only", ops, sA.id, "update", ago(4), { note: "Checking demurrage", visible: false });
await expectRows("hidden update is suppressed for notification", null, "select 1 from milestone_events where milestone_type = 'update' and notification_state = 'suppressed'", 1);
const clientTl = (await as(cA, "select milestone_type from client_timeline($1)", [sA.id])).rows;
const staffCount = (await as(ops, "select count(*)::int n from milestone_events where shipment_id = $1", [sA.id])).rows[0].n;
clientTl.length > 0 && !clientTl.some((r) => r.milestone_type === "update") && staffCount > clientTl.length
  ? ok("client does not see the hidden update") : bad("visibility", `${clientTl.length} vs ${staffCount}`);

console.log("\nAppend-only + corrections (AC-03):");
const evDis1 = (await db.query("select id, event_at from milestone_events where container_id = $1 and milestone_type = 'container_discharged'", [c1])).rows[0];
await expectError("events cannot be edited", null, "update milestone_events set public_note = 'x' where id = $1", /append-only/, [evDis1.id]);
await expectError("events cannot be deleted", null, "delete from milestone_events where id = $1", /append-only/, [evDis1.id]);
await expectOk("notification state can be updated (worker)", null, "update milestone_events set notification_state = 'sent' where id = $1", [evDis1.id]);
await expectError("users have no update privilege on events", ops, "update milestone_events set public_note = 'x'", /permission denied/);

const CM = "select correct_milestone($1, $2, $3, $4::timestamptz, $5, $6)";
const newAt = ago(81);
await expectError("a correction needs a reason", agent, CM, /reason/, [evDis1.id, " ", false, newAt, null, null]);
await expectError("client cannot correct", cA, CM, /not allowed/, [evDis1.id, "wrong time", false, newAt, null, null]);
await expectError("another staff member cannot correct someone else's event", transport, CM, /Only the person/, [evDis1.id, "wrong time", false, newAt, null, null]);
await expectOk("recorder corrects the discharge time within 24 h", agent, CM, [evDis1.id, "Terminal report shows 1 h earlier", false, newAt, null, null]);
await expectRows("original is kept; correction is a new row", null, "select 1 from milestone_events where id = $1 and event_at = $2", 1, [evDis1.id, evDis1.event_at]);
await expectRows("timeline shows the corrected time", ops, "select 1 from milestone_timeline where id = $1 and is_corrected and event_at = $2 and original_event_at = $3", 1, [evDis1.id, newAt, evDis1.event_at]);
Math.abs(new Date((await contOf(c1)).discharge_at) - new Date(newAt)) < 1000 ? ok("container discharge time follows the correction") : bad("discharge_at", String((await contOf(c1)).discharge_at));
await expectError("corrections are corrected via the original", ops, CM, /original/,
  [(await db.query("select id from milestone_events where correction_of_event_id = $1", [evDis1.id])).rows[0].id, "again", false, newAt, null, null]);

const evLoaded1 = (await db.query("select id from milestone_events where container_id = $1 and milestone_type = 'loaded'", [c1])).rows[0].id;
await expectError("an event with later milestones cannot be cancelled", ops, CM, /Later milestones/, [evLoaded1, "wrong", true, null, null, null]);
const evRelease = (await db.query("select id from milestone_events where milestone_type = 'customs_released' and shipment_id = $1", [sA.id])).rows[0].id;
await expectError("customs release cannot be cancelled after a gate-out", ops, CM, /Later milestones/, [evRelease, "wrong", true, null, null, null]);
const evGate2 = ovr?.rows[0]?.event_id;
await expectError("transport coordinator cannot cancel the ops manager's event", transport, CM, /Only the person/, [evGate2, "mistake", true, null, null, null]);
await expectOk("ops manager cancels container 2 gate-out", ops, CM, [evGate2, "Truck did not leave; recorded by mistake", true, null, null, null]);
const k2b = await contOf(c2);
k2b.operational_status === "loaded" && k2b.gate_out_at === null && k2b.transport_status === "loaded"
  ? ok("cancel restores container 2 exactly (status, time, transport)") : bad("void restore", JSON.stringify(k2b));
(await statusOf(sA.id)).overall_status === "loaded" ? ok("overall status recomputed (least advanced = loaded)") : bad("overall", (await statusOf(sA.id)).overall_status);
await expectRows("staff timeline shows it cancelled, with reason", ops, "select 1 from milestone_timeline where id = $1 and is_voided and void_reason like 'Truck%'", 1, [evGate2]);
const gate2Batch = (await db.query("select batch_id from milestone_events where id = $1", [evGate2])).rows[0].batch_id;
await expectRows("…(that batch is not in the client timeline)", cA, "select 1 from client_timeline($1) where batch_id = $2", 0, [sA.id, gate2Batch]);
await expectError("cannot cancel twice", ops, CM, /already been cancelled/, [evGate2, "again", true, null, null, null]);
await ms("container 2 gate-out recorded again, normally", transport, sA.id, "gate_out", ago(3), { containers: [c2], location: "Dar ICD" });

console.log("\nAwaiting documents:");
await ms("doc officer confirms the registered shipment with missing documents", doc, newId, "shipment_confirmed", ago(2));
(await statusOf(newId)).overall_status === "awaiting_documents" ? ok("missing documents → awaiting documents") : bad("awaiting", (await statusOf(newId)).overall_status);

console.log("\nETA revisions (0011, AC-09):");
const RE = "select * from revise_eta($1::uuid, $2::timestamptz, $3::eta_reason_category, $4, $5)";
const ahead = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const etaOf = async (id) => (await db.query("select current_eta, eta_reason, eta_updated_at from shipments where id = $1", [id])).rows[0];
await expectError("finance cannot change the ETA", finance, RE, /not allowed/, [sA.id, ahead(72), "schedule_confirmed", "Plan", true]);
await expectError("client cannot change the ETA", cA, RE, /not allowed/, [sA.id, ahead(72), "schedule_confirmed", "Plan", true]);
await expectError("ETA needs a reason", transport, RE, /reason/, [sA.id, ahead(72), "schedule_confirmed", " ", true]);
await expectError("ETA cannot be in the past", transport, RE, /past/, [sA.id, ago(5), "schedule_confirmed", "Plan", true]);
await expectError("agent cannot revise an unassigned shipment", agent, RE, /not found/, [sB.id, ahead(72), "customs", "Hold", true]);
await expectError("current_eta cannot be written directly", admin, "update shipments set current_eta = now() where id = $1", /permission denied/, [sA.id]);
const e1 = await expectOk("first ETA set by transport", transport, RE, [sA.id, ahead(72), "schedule_confirmed", "Truck departed Dar; 3 days to Kigali", true]);
e1?.rows[0]?.material === true ? ok("the first ETA is material") : bad("first material", JSON.stringify(e1?.rows));
const e2 = await expectOk("ETA +1 h (delivery 3 days away)", transport, RE, [sA.id, ahead(73), "road_conditions", "Slow traffic at Morogoro", true]);
e2?.rows[0]?.material === false && e2.rows[0].minutes_changed === 60 ? ok("1 h change is not material (threshold 6 h)") : bad("not material", JSON.stringify(e2?.rows));
await expectRows("immaterial change is suppressed for notification", null,
  "select 1 from eta_revisions where shipment_id = $1 and not is_material and notification_state = 'suppressed' and threshold_hours = 6", 1, [sA.id]);
await expectOk("ETA moved to today (+10 h)", transport, RE, [sA.id, ahead(10), "schedule_confirmed", "Border cleared early", true]);
const e4 = await expectOk("same-day ETA +3 h", transport, RE, [sA.id, ahead(13), "border_delay", "Queue at Rusumo", true]);
e4?.rows[0]?.material === true ? ok("3 h change is material when delivery is due within 24 h (threshold 2 h)") : bad("same-day", JSON.stringify(e4?.rows));
const e5 = await expectOk("same-day ETA +1 h", transport, RE, [sA.id, ahead(14), "border_delay", "Still queueing", false]);
e5?.rows[0]?.material === false ? ok("1 h same-day change is not material") : bad("same-day small", JSON.stringify(e5?.rows));
const eta = await etaOf(sA.id);
Math.abs(new Date(eta.current_eta) - new Date(ahead(14))) < 5000 && eta.eta_reason === "Schedule updated" ? ok("shipment shows the current ETA; a staff-only reason stays off the client-readable row (0019)") : bad("eta", JSON.stringify(eta));
await expectRows("client cannot read the hidden reason anywhere", cA, "select 1 from shipments where id = $1 and eta_reason = 'Still queueing' union all select 1 from eta_revisions where reason = 'Still queueing'", 0, [sA.id]);
await expectRows("staff still see the real reason in the history", ops, "select 1 from eta_revisions where shipment_id = $1 and reason = 'Still queueing'", 1, [sA.id]);
await expectRows("previous ETAs stay auditable (5 revisions)", ops, "select 1 from eta_revisions where shipment_id = $1", 5, [sA.id]);
await expectRows("client sees client-visible revisions only", cA, "select 1 from eta_revisions where shipment_id = $1", 4, [sA.id]);
await expectRows("other client sees none", cB, "select 1 from eta_revisions", 0);
await expectError("same ETA again is refused", transport, RE, /unchanged/, [sA.id, eta.current_eta, "other", "No change", true]);
const rev1 = (await db.query("select id from eta_revisions where shipment_id = $1 limit 1", [sA.id])).rows[0].id;
await expectError("revisions cannot be edited", null, "update eta_revisions set reason = 'x' where id = $1", /append-only/, [rev1]);
await expectError("revisions cannot be deleted", null, "delete from eta_revisions where id = $1", /append-only/, [rev1]);
await expectError("users cannot write revisions", ops, "insert into eta_revisions (shipment_id, new_eta, reason_category, reason, is_material, threshold_hours, notification_state) values ($1, now(), 'other', 'xxx', true, 6, 'pending')", /permission denied/, [sA.id]);
await expectRows("doc officer cannot change thresholds", doc, "update app_settings set value = '1' where key = 'eta.material_hours_other' returning key", 0);
await expectRows("admin can change thresholds", admin, "update app_settings set value = '8' where key = 'eta.material_hours_other' returning key", 1);
await expectRows("threshold change is audited", null, "select 1 from audit_log where table_name = 'app_settings' and action = 'UPDATE' and actor_id = $1", 1, [admin]);
await db.query("update app_settings set value = '6' where key = 'eta.material_hours_other'");
await expectRows("clients cannot read settings", cA, "select 1 from app_settings", 0);

console.log("\nTransport (0012):");
await expectRows("staff read the configured routes", transport, "select 1 from routes", 4);
await expectRows("clients do not read routes", cA, "select 1 from routes", 0);
await expectError("transport coordinator cannot add routes", transport,
  "insert into routes (code, name, origin_port_id, destination_country, destination_city, transit_estimate_hours) values ('DAR-GOM', 'Dar to Goma', $1, 'CD', 'Goma', 120)", /row-level security/, [dar]);
await expectOk("ops manager adds a route", ops,
  "insert into routes (code, name, origin_port_id, destination_country, destination_city, border_crossing, transit_estimate_hours) values ('DAR-GOM', 'Dar es Salaam → Goma via Rusumo', $1, 'CD', 'Goma', 'Rusumo; Gisenyi', 120)", [dar]);
const kgl = (await db.query("select id from routes where code = 'DAR-KGL'")).rows[0].id;

// fresh shipment for client A, moved to ready for dispatch by the ops manager
const okT = await expectOk("doc officer registers a shipment for the transport checks", doc, reg,
  [shipJson("TESTBL-TRN"), JSON.stringify([{ container_number: "TRNU1000000" }, { container_number: "TRNU1000015" }])]);
const sT = okT?.rows[0]?.shipment_id;
const [t1, t2] = (await db.query("select id from containers where shipment_id = $1 order by container_number", [sT])).rows.map((r) => r.id);
await ms("confirm", doc, sT, "shipment_confirmed", ago(60));
await ms("vessel arrived", ops, sT, "vessel_arrived", ago(59), { location: "Dar es Salaam" });
await ms("discharged", ops, sT, "container_discharged", ago(58), { containers: [t1, t2], location: "TICTS" });
await ms("port processing", ops, sT, "port_processing_started", ago(57), { containers: [t1, t2] });
await ms("ready for dispatch", ops, sT, "ready_for_dispatch", ago(2), { containers: [t1, t2] });

await expectError("clearing agent cannot assign transport", agent, AT, /not allowed/, atArgs(sT, [t1]));
await expectError("invalid truck registration is refused", transport, AT, /truck registration/, atArgs(sT, [t1], { truck: "<script>" }));
await expectError("driver phone must be international", transport, AT, /international/, atArgs(sT, [t1], { driverName: "Eric N.", phone: "0788123456" }));
await expectError("driver user must have the driver role", transport, AT, /not an active driver/, atArgs(sT, [t1], { driverName: "Eric N.", driverUser: agent }));
await expectError("container of another shipment is refused", transport, AT, /not on this shipment/, atArgs(sT, [c1]));
const asg1 = await expectOk("transport assigns truck, driver and route to container 1", transport, AT,
  atArgs(sT, [t1], { truck: " t 456 def ", trailer: "tl 789", driverName: "Eric Niyonzima (fictional)", phone: "+250 788 000 111",
    driverUser: driver, route: kgl, planned: ahead(4), refs: ["T1-2026-0001", " "] }));
const a1 = asg1?.rows[0]?.id;
const aRow = (await db.query("select * from transport_assignments where id = $1", [a1])).rows[0];
aRow?.truck_registration === "T 456 DEF" && aRow.border_crossing === "Rusumo" && aRow.transit_document_refs.length === 1
  ? ok("registration normalised, border taken from the route, empty refs dropped") : bad("assignment row", JSON.stringify(aRow));
(await contOf(t1)).operational_status === "truck_assigned" ? ok("container 1 → truck assigned") : bad("t1", (await contOf(t1)).operational_status);
await expectRows("the driver user is given access to the shipment", null, "select 1 from shipment_assignments where shipment_id = $1 and user_id = $2", 1, [sT, driver]);
await expectError("a container cannot get a second truck", transport, AT, /already has a truck/, atArgs(sT, [t1], { truck: "T 999 ZZZ" }));
await expectRows("client sees the truck (client_transport), without driver details", cA,
  "select 1 from client_transport($1) where truck_registration = 'T 456 DEF' and driver_name is null and driver_phone is null", 1, [sT]);
await expectRows("client cannot read transport_assignments directly (cancel reasons)", cA, "select 1 from transport_assignments", 0);
await expectRows("client cannot see the driver's name or phone", cA, "select 1 from driver_contacts", 0);
await expectRows("other client sees no assignment", cB, "select 1 from transport_assignments where shipment_id = $1", 0, [sT]);
await expectRows("assigned driver sees own contact record", driver, "select 1 from driver_contacts where assignment_id = $1", 1, [a1]);
await expectRows("staff see the driver contact", ops, "select 1 from driver_contacts where assignment_id = $1 and driver_phone = '+250788000111'", 1, [a1]);
await expectError("assignments cannot be inserted directly", transport,
  "insert into transport_assignments (shipment_id, transporter_name, truck_registration) values ($1, 'X Ltd', 'T 1 A')", /permission denied/, [sT]);
await expectError("assignment status cannot be changed directly", ops, "update transport_assignments set status = 'cancelled' where id = $1", /permission denied/, [a1]);
await expectRows("planned loading can be updated", transport, "update transport_assignments set planned_loading_at = now() + interval '5 hours' where id = $1 returning id", 1, [a1]);

await ms("container 1 loaded", transport, sT, "loaded", ago(1), { containers: [t1], seal: "SEAL-T1" });
(await db.query("select actual_loading_at from transport_assignments where id = $1", [a1])).rows[0].actual_loading_at
  ? ok("loaded milestone records the actual loading time") : bad("actual loading", "null");
await msErr("gate-out still blocked by customs", transport, sT, "gate_out", ago(0.5), { containers: [t1], location: "Dar ICD" }, /customs is not released/);
for (const m of ["customs_entry_prepared", "customs_submitted", "customs_released"]) await ms(m, ops, sT, m, ago(0.6));
await ms("container 1 gate-out with truck and release", transport, sT, "gate_out", ago(0.2), { containers: [t1], location: "Dar ICD" });

const asg2 = await expectOk("truck for container 2", transport, AT, atArgs(sT, [t2], { truck: "T 222 BBB", driverName: "Paul K. (fictional)" }));
await ms("container 2 loaded", transport, sT, "loaded", ago(0.4), { containers: [t2] });
const CT = "select cancel_transport_assignment($1, $2)";
await expectError("agent cannot cancel transport", agent, CT, /not allowed/, [asg2?.rows[0]?.id, "Breakdown"]);
await expectError("cancel needs a reason", transport, CT, /reason/, [asg2?.rows[0]?.id, " "]);
await expectOk("transport cancels container 2's truck (breakdown)", transport, CT, [asg2?.rows[0]?.id, "Truck broke down at the ICD"]);
await expectRows("cancellation recorded as a staff-only update with the reason internal", null,
  "select 1 from milestone_events e join milestone_internal_notes n on n.batch_id = e.batch_id where e.shipment_id = $1 and e.milestone_type = 'update' and not e.client_visible and n.note like 'Reason: Truck broke down%'", 1, [sT]);
await msErr("gate-out without a truck is blocked", transport, sT, "gate_out", ago(0.1), { containers: [t2], location: "Dar ICD" }, /Assign a truck/);
await expectOk("replacement truck for container 2", transport, AT, atArgs(sT, [t2], { truck: "T 333 CCC" }));
(await contOf(t2)).operational_status === "loaded" ? ok("re-assignment keeps the container loaded (recorded as an update)") : bad("t2", (await contOf(t2)).operational_status);
await expectError("cannot cancel after gate-out", transport, CT, /already left/, [a1, "Changed mind"]);
await expectError("cannot cancel twice", transport, CT, /already cancelled/, [asg2?.rows[0]?.id, "again"]);
await ms("container 2 gate-out", transport, sT, "gate_out", ago(0.05), { containers: [t2], location: "Dar ICD" });
(await statusOf(sT)).overall_status === "in_transit" ? ok("shipment in transit") : bad("sT", (await statusOf(sT)).overall_status);

console.log("\nExceptions & SLA (0013, AC-10):");
const OX = "select open_exception($1::uuid, $2::exception_type, $3, $4::exception_severity, $5, $6::uuid, $7::uuid, $8, $9::timestamptz, $10, $11) id";
const oxArgs = (ship, o = {}) => [ship, o.type ?? "customs_hold", o.title ?? "Customs hold on T1 document", o.severity ?? "high",
  o.details ?? "Officer queried the HS code", o.container ?? null, o.owner ?? null, o.next ?? "Send corrected invoice", o.follow ?? ahead(4),
  o.clientMessage ?? null, o.clientVisible ?? false];
const flag = async (id) => (await db.query("select has_open_exception from shipments where id = $1", [id])).rows[0].has_open_exception;
await expectError("client cannot open exceptions", cA, OX, /not allowed/, oxArgs(sA.id));
await expectError("driver cannot open exceptions", driver, OX, /not allowed/, oxArgs(sA.id));
await expectError("title is required", doc, OX, /title/, oxArgs(sA.id, { title: "x" }));
await expectError("container must be on the shipment", doc, OX, /not on this shipment/, oxArgs(sA.id, { container: t1 }));
const x1 = (await expectOk("doc officer opens an exception on shipment A", doc, OX, oxArgs(sA.id, { container: c1 })))?.rows[0]?.id;
(await flag(sA.id)) ? ok("shipment flagged with an open exception; status unchanged") : bad("flag", "false");
const xr = (await db.query("select owner_id, last_event_id, next_action, source from exceptions where id = $1", [x1])).rows[0];
xr.owner_id === doc && xr.last_event_id && xr.source === "staff" ? ok("owner defaults to the shipment's responsible person; last event linked") : bad("exception row", JSON.stringify(xr));
await expectRows("client cannot read exceptions (internal details)", cA, "select 1 from exceptions", 0);
await expectRows("driver cannot read exceptions", driver, "select 1 from exceptions", 0);
await expectRows("agent assigned to shipment A sees it", agent, "select 1 from exceptions where id = $1", 1, [x1]);
await expectRows("finance sees it", finance, "select 1 from exceptions where id = $1", 1, [x1]);
await expectError("exceptions cannot be written directly", ops, "update exceptions set status = 'resolved' where id = $1", /permission denied/, [x1]);

const UX = "select update_exception($1, $2, $3, $4::timestamptz, $5::uuid, $6::exception_severity)";
await expectOk("transport adds a follow-up note", transport, UX, [x1, "Called the customs office", null, null, null, null]);
await expectError("non-owner cannot reassign", transport, UX, /Only the owner/, [x1, null, null, null, transport, null]);
await expectError("owner must be staff", ops, UX, /active NGB staff/, [x1, null, null, null, cA, null]);
await expectOk("ops manager reassigns to transport and raises severity", ops, UX, [x1, null, "Collect corrected T1", ahead(2), transport, "critical"]);
await expectRows("each change is logged", null, "select kind from exception_updates where exception_id = $1", 5, [x1]);
const EX = "select escalate_exception($1, $2)";
await expectError("escalation needs a note", transport, EX, /Say why/, [x1, ""]);
await expectOk("owner escalates to the operations manager", transport, EX, [x1, "Client threatening to cancel"]);
await expectError("cannot escalate twice", transport, EX, /already escalated/, [x1, "again"]);
const RX = "select resolve_exception($1, $2)";
await expectError("non-owner staff cannot resolve", agent, RX, /Only the owner/, [x1, "Done"]);
await expectError("resolution needs a description", transport, RX, /Describe/, [x1, ""]);
await expectOk("owner resolves with a resolution", transport, RX, [x1, "Corrected invoice accepted; T1 released"]);
!(await flag(sA.id)) ? ok("flag cleared when no exception is open") : bad("flag", "still true");
await expectError("cannot update a resolved exception", ops, UX, /resolved/, [x1, "late note", null, null, null, null]);
const xu1 = (await db.query("select id from exception_updates where exception_id = $1 limit 1", [x1])).rows[0].id;
await expectError("exception log is append-only", null, "delete from exception_updates where id = $1", /not allowed|append-only|permitted/i, [xu1]);

// SLA scan
const SCAN = "select * from run_sla_scan()";
await expectError("transport cannot run the SLA check", transport, SCAN, /Only an operations manager/);
await expectError("SLA internals are not callable", ops, "select * from private.sla_scan()", /permission denied/);
const okS = await expectOk("doc officer registers a shipment for the SLA checks", doc, reg,
  [shipJson("TESTBL-SLA"), JSON.stringify([{ container_number: "SLAU1000003" }])]);
const sS = okS?.rows[0]?.shipment_id;
const s1 = (await db.query("select id from containers where shipment_id = $1", [sS])).rows[0].id;
await ms("confirm", doc, sS, "shipment_confirmed", ago(120));
await ms("vessel arrived", ops, sS, "vessel_arrived", ago(110), { location: "Dar es Salaam" });
await ms("discharged 100 h ago", ops, sS, "container_discharged", ago(100), { containers: [s1], location: "TICTS" });
const scan1 = await expectOk("ops manager runs the SLA check", ops, SCAN);
scan1?.rows[0]?.opened >= 1 ? ok(`scan opened ${scan1.rows[0].opened} exception(s)`) : bad("scan", JSON.stringify(scan1?.rows));
const px = (await db.query("select * from exceptions where dedup_key = $1 and status = 'open'", [`port_processing:${s1}`])).rows[0];
px && px.exception_type === "port_sla_breach" && px.owner_id === doc && px.last_event_id && px.next_action && px.source === "system"
  ? ok("port SLA breach queued with owner, last event and next action (AC-10)") : bad("port exception", JSON.stringify(px));
(await flag(sS)) && (await statusOf(sS)).overall_status === "container_discharged" ? ok("status kept (exception is not a status)") : bad("sS", "flag/status");
const scan2 = (await as(ops, SCAN)).rows[0];
(await db.query("select count(*)::int n from exceptions where dedup_key = $1", [`port_processing:${s1}`])).rows[0].n === 1
  ? ok("running again does not duplicate") : bad("dedup", JSON.stringify(scan2));
await db.query("update exceptions set opened_at = now() - interval '25 hours' where id = $1", [px.id]);
await as(ops, SCAN);
(await db.query("select escalated_at from exceptions where id = $1", [px.id])).rows[0].escalated_at
  ? ok("unresolved past 24 h → escalated to the operations manager") : bad("escalation", "not escalated");
await ms("port processing", ops, sS, "port_processing_started", ago(40), { containers: [s1] });
await ms("ready for dispatch 30 h ago", ops, sS, "ready_for_dispatch", ago(30), { containers: [s1] });
await as(ops, SCAN);
const pxAfter = (await db.query("select status, resolution from exceptions where id = $1", [px.id])).rows[0];
pxAfter.status === "resolved" && /Cleared automatically/.test(pxAfter.resolution) ? ok("port exception cleared once the container moved on") : bad("clear", JSON.stringify(pxAfter));
await expectRows("dispatch risk opened (ready > 24 h, not gated out)", null,
  "select 1 from exceptions where dedup_key = $1 and status = 'open' and exception_type = 'dispatch_risk'", 1, [`dispatch:${s1}`]);
// empty return overdue (container 1 of shipment A, delivered by the driver)
await ms("driver records delivery", driver, sA.id, "delivered", ago(48), { containers: [c1] });
await expectOk("return deadline set (yesterday)", doc, "update containers set return_deadline = current_date - 1 where id = $1", [c1]);
await as(ops, SCAN);
await expectRows("return overdue exception opened", null,
  "select 1 from exceptions where dedup_key = $1 and status = 'open' and exception_type = 'return_overdue'", 1, [`empty_return:${c1}`]);
(await contOf(c1)).return_status === "return_overdue" ? ok("container return status → overdue") : bad("return", (await contOf(c1)).return_status);
await expectRows("system actions are logged without a user", null,
  "select 1 from exception_updates u join exceptions x on x.id = u.exception_id where x.source = 'system' and u.created_by is null", 5);

console.log("\nNotifications (0014, AC-06/07/08):");
async function asService(sql, params = []) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.exec("set role service_role");
  try { return await db.query(sql, params); } finally { await db.exec("reset role"); }
}
const notesOf = async (uid, template) => (await db.query(
  "select * from notifications where recipient_id = $1 and template_key = $2 order by created_at", [uid, template])).rows;
await expectRows("client users got a welcome notification", null,
  "select 1 from notifications where template_key = 'account.activated' and recipient_id = any($1)", 2, [[cA, cB]]);
(await notesOf(cA, "milestone.shipment_confirmed")).length >= 1 ? ok("client A notified: shipment confirmed") : bad("confirmed", "none");
const ppBatch = (await db.query("select batch_id from milestone_events where shipment_id = $1 and milestone_type = 'port_processing_started' and correction_of_event_id is null limit 1", [sA.id])).rows[0].batch_id;
const ppNote = (await db.query("select payload from notifications where event_key = $1 and recipient_id = $2", [`milestone:${ppBatch}`, cA])).rows;
ppNote.length === 1 && ppNote[0].payload.containers?.length === 2 && ppNote[0].payload.reference === sA.shipment_reference
  ? ok("one notification per batch, listing both containers") : bad("batch", JSON.stringify(ppNote));
await expectRows("staff-only update is not notified", null,
  "select 1 from notifications n join milestone_events e on n.event_key = 'milestone:' || e.batch_id where e.milestone_type = 'update' and not e.client_visible", 0);
await expectRows("no override/correction text in client payloads", null,
  "select 1 from notifications where audience = 'client' and (payload::text ilike '%override%' or payload::text ilike '%Release confirmed by phone%')", 0);
await expectRows("material ETA changes notified (3 of 5 revisions)", null,
  "select 1 from notifications where template_key = 'eta.changed' and shipment_id = $1 and recipient_id = $2", 3, [sA.id, cA]);
await expectRows("rejected document asks the client to act, with the reason", null,
  "select 1 from notifications where template_key = 'document.rejected' and recipient_id = $1 and payload ->> 'reason' like 'Rejected: Amount%'", 1, [cA]);
await expectRows("SLA-opened exception alerts its owner", null,
  "select 1 from notifications where template_key = 'staff.exception_opened' and recipient_id = $1", 3, [doc]);
await expectRows("escalations alert the operations manager", null,
  "select 1 from notifications where template_key = 'staff.exception_escalated' and recipient_id = $1", 2, [ops]);
await expectRows("clients never get staff templates, staff never client ones", null,
  "select 1 from notifications n join profiles p on p.id = n.recipient_id where (n.audience = 'staff') <> (p.role <> 'client')", 0);
await expectRows("client B got nothing about client A's shipments", null,
  "select 1 from notifications n join shipments s on s.id = n.shipment_id where n.recipient_id = $1 and s.client_id = $2", 0, [cB, A]);
await expectRows("push deliveries queued for client A (push on by default)", null,
  "select 1 from notification_deliveries d join notifications n on n.id = d.notification_id where n.recipient_id = $1 and d.channel = 'push' and d.state = 'pending' limit 1", 1, [cA]);
await expectRows("no WhatsApp without opt-in", null,
  "select 1 from notification_deliveries d join notifications n on n.id = d.notification_id where n.recipient_id = $1 and d.channel = 'whatsapp'", 0, [cA]);
const before08 = (await db.query("select count(*)::int n from notification_deliveries")).rows[0].n;
const re = (await db.query("select private.enqueue_notification($1, 'milestone.port_processing_started', $2, '{}'::jsonb, $3) n",
  [`milestone:${ppBatch}`, sA.id, [cA, cB]])).rows[0].n;
const after08 = (await db.query("select count(*)::int n from notification_deliveries")).rows[0].n;
re === 0 && after08 === before08 ? ok("re-processing the same event sends nothing again; other clients never added (AC-08)") : bad("dedup", `${re} new, ${after08 - before08} deliveries`);

// RLS
await expectRows("client A reads only its own notifications", cA, "select 1 from notifications where recipient_id <> $1", 0, [cA]);
await expectRows("client A cannot read B's notification by id", cA,
  "select 1 from notifications where id = (select id from notifications where recipient_id = $1 limit 1)", 0, [cB]);
const n1 = (await notesOf(cA, "account.activated"))[0].id;
await expectRows("client marks own notification read", cA, "update notifications set read_at = now() where id = $1 returning id", 1, [n1]);
await expectRows("…but not someone else's", cA, "update notifications set read_at = now() where recipient_id = $1 returning id", 0, [cB]);
await expectError("payload cannot be edited", cA, "update notifications set payload = '{}' where id = $1", /permission denied/, [n1]);
await expectError("clients cannot create notifications", cA,
  "insert into notifications (recipient_id, audience, event_key, template_key) values ($1, 'client', 'x', 'account.activated')", /permission denied/, [cA]);
await expectRows("client sees own deliveries only", cB, "select 1 from notification_deliveries d join notifications n on n.id = d.notification_id where n.recipient_id = $1", 0, [cA]);
await expectRows("delivery attempts are staff-only", cA, "select 1 from notification_delivery_attempts", 0);

const sub = { endpoint: "https://push.example.test/send/abc123", p256dh: "B".repeat(87), auth: "A".repeat(22) };
await expectOk("client registers a push subscription", cA, "insert into push_subscriptions (endpoint, p256dh, auth) values ($1, $2, $3)", [sub.endpoint, sub.p256dh, sub.auth]);
await expectError("…only for itself", cA, "insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)", /permission denied|row-level/, [cB, "https://push.example.test/x", sub.p256dh, sub.auth]);
await expectError("plain http endpoints refused", cA, "insert into push_subscriptions (endpoint, p256dh, auth) values ('http://evil.test/x', $1, $2)", /check constraint/, [sub.p256dh, sub.auth]);
await expectRows("other users cannot see it", cB, "select 1 from push_subscriptions", 0);
await expectError("anonymous cannot register", "anon", "insert into push_subscriptions (endpoint, p256dh, auth) values ($1, $2, $3)", /permission denied/, ["https://push.example.test/y", sub.p256dh, sub.auth]);

// WhatsApp consent stamped by the database
await expectError("WhatsApp opt-in needs a phone number", cA, "update notification_preferences set whatsapp_opt_in = true where user_id = $1", /whatsapp_consent_recorded/, [cA]);
await expectOk("client opts in to WhatsApp (consent time faked)", cA,
  "update notification_preferences set whatsapp_opt_in = true, whatsapp_phone = '+250788000001', consent_at = '2020-01-01', consent_source = 'portal' where user_id = $1", [cA]);
const pref = (await db.query("select consent_at from notification_preferences where user_id = $1", [cA])).rows[0];
Date.now() - new Date(pref.consent_at) < 60e3 ? ok("consent time is set by the database, not the client") : bad("consent", String(pref.consent_at));
await ms("delivery recorded (WhatsApp-eligible)", driver, sT, "arrived", ago(0.04), { containers: [t1] });
await expectRows("opted-in client gets a WhatsApp delivery for a key milestone", null,
  "select 1 from notification_deliveries d join notifications n on n.id = d.notification_id where n.recipient_id = $1 and n.template_key = 'milestone.arrived' and d.channel = 'whatsapp'", 1, [cA]);
await ms("offloading (push only by rule)", driver, sT, "offloading_started", ago(0.03), { containers: [t1] });
await expectRows("…but not for minor ones", null,
  "select 1 from notification_deliveries d join notifications n on n.id = d.notification_id where n.recipient_id = $1 and n.template_key = 'milestone.offloading_started' and d.channel = 'whatsapp'", 0, [cA]);

// Sender API
await expectError("users cannot claim deliveries", ops, "select * from claim_notification_deliveries(10)", /permission denied/);
const claimed = (await asService("select * from claim_notification_deliveries(500)")).rows;
claimed.length > 0 ? ok(`sender claims due deliveries (${claimed.length})`) : bad("claim", "none");
const pushRow = claimed.find((r) => r.channel === "push" && r.recipient_id === cA);
pushRow?.subscriptions?.[0]?.endpoint === sub.endpoint && pushRow.timezone && pushRow.locale === "en"
  ? ok("claim returns the device subscriptions, locale and time zone") : bad("claim row", JSON.stringify(pushRow));
const waRow = claimed.find((r) => r.channel === "whatsapp");
waRow?.whatsapp_phone === "+250788000001" ? ok("WhatsApp claim carries the consented number") : bad("wa row", JSON.stringify(waRow));
(await asService("select count(*)::int n from claim_notification_deliveries(500)")).rows[0].n === 0
  ? ok("claimed rows are locked (a second sender gets none)") : bad("lock", "re-claimed");
const CD = "select complete_notification_delivery($1, $2, $3, $4, $5, $6, $7, $8::text[])";
await asService(CD, [pushRow.delivery_id, true, "push-ok-1", null, null, false, false, null]);
await expectRows("success → sent, attempt logged", null,
  "select 1 from notification_deliveries d join notification_delivery_attempts a on a.delivery_id = d.id where d.id = $1 and d.state = 'sent' and a.ok and a.provider_message_id = 'push-ok-1'", 1, [pushRow.delivery_id]);
await asService(CD, [pushRow.delivery_id, false, null, "late", "duplicate completion", false, false, null]);
await expectRows("a late duplicate completion changes nothing", null, "select 1 from notification_delivery_attempts where delivery_id = $1", 1, [pushRow.delivery_id]);
await asService(CD, [waRow.delivery_id, false, null, "provider_503", "Service unavailable", false, false, null]);
const waAfter = (await db.query("select state, attempt_count, next_attempt_at from notification_deliveries where id = $1", [waRow.delivery_id])).rows[0];
waAfter.state === "pending" && new Date(waAfter.next_attempt_at) - Date.now() > 50e3
  ? ok("transient failure → retried after a 1 minute backoff") : bad("backoff", JSON.stringify(waAfter));
await db.query("update notification_deliveries set next_attempt_at = now(), attempt_count = 4 where id = $1", [waRow.delivery_id]);
await asService("select * from claim_notification_deliveries(500)");
await asService(CD, [waRow.delivery_id, false, null, "provider_503", "Still unavailable", false, false, null]);
await expectRows("after 5 attempts → failed (bounded retries)", null, "select 1 from notification_deliveries where id = $1 and state = 'failed' and attempt_count = 5", 1, [waRow.delivery_id]);
await expectRows("every attempt is logged", null, "select 1 from notification_delivery_attempts where delivery_id = $1", 2, [waRow.delivery_id]);
const other = claimed.find((r) => r.channel === "push" && r.delivery_id !== pushRow.delivery_id && r.recipient_id === cA);
await asService(CD, [other.delivery_id, false, null, "push_410", "Gone", true, false, [sub.endpoint]]);
await expectRows("expired device: permanent failure and the subscription is removed", null,
  "select 1 from push_subscriptions where endpoint = $1", 0, [sub.endpoint]);
const noDevice = claimed.find((r) => r.channel === "push" && r.recipient_id !== cA);
if (noDevice) {
  await asService(CD, [noDevice.delivery_id, false, null, "no_subscription", null, false, true, null]);
  await expectRows("no device → suppressed, not failed", null, "select 1 from notification_deliveries where id = $1 and state = 'suppressed'", 1, [noDevice.delivery_id]);
}
await expectError("doc officer cannot retry notifications", doc, "select retry_notification_delivery($1)", /Only an operations manager/, [waRow.delivery_id]);
await expectOk("ops manager retries the failed WhatsApp message", ops, "select retry_notification_delivery($1)", [waRow.delivery_id]);
await expectRows("…which is pending again", null, "select 1 from notification_deliveries where id = $1 and state = 'pending' and attempt_count = 0", 1, [waRow.delivery_id]);
await expectError("only failed ones can be retried", ops, "select retry_notification_delivery($1)", /Only failed/, [pushRow.delivery_id]);
await db.query("update notification_deliveries set created_at = now() - interval '25 hours' where id = $1", [waRow.delivery_id]);
await asService("select * from claim_notification_deliveries(1)");
await expectRows("undelivered for 24 h → failed as expired", null, "select 1 from notification_deliveries where id = $1 and state = 'failed' and error_code = 'expired'", 1, [waRow.delivery_id]);
await db.query("update notification_deliveries set state = 'sent' where state in ('pending', 'sending')"); // tidy for later checks

console.log("\nClient portal (0015):");
const tl = (await as(cA, "select * from client_timeline($1)", [sA.id])).rows;
tl.length > 5 && tl.every((r) => r.label && r.event_at) && !("override_reason" in tl[0]) && !("recorded_by" in tl[0])
  ? ok(`client timeline: ${tl.length} entries, no internal columns`) : bad("client timeline", JSON.stringify(tl[0]));
tl.some((r) => r.is_corrected) ? ok("corrections applied in the client timeline") : bad("corrected", "none");
await expectRows("other client gets nothing from the timeline function", cB, "select 1 from client_timeline($1)", 0, [sA.id]);
await expectRows("other client gets nothing from the transport function", cB, "select 1 from client_transport($1)", 0, [sT]);
await expectOk("admin enables driver contact for client A (policy)", admin, "update organizations set show_driver_contact = true where id = $1", [A]);
await expectRows("policy alone is not enough (driver has not agreed)", cA, "select 1 from client_transport($1) where driver_name is not null", 0, [sT]);
await expectRows("transport records the driver's consent", transport, "update driver_contacts set share_with_client = true where assignment_id = $1 returning 1", 1, [a1]);
await expectRows("policy + consent → client sees the driver contact", cA,
  "select 1 from client_transport($1) where driver_name = 'Eric Niyonzima (fictional)' and driver_phone = '+250788000111'", 1, [sT]);
await expectRows("clients cannot set the driver consent", cA, "update driver_contacts set share_with_client = false where assignment_id = $1 returning 1", 0, [a1]);
await expectRows("…consent unchanged", null, "select 1 from driver_contacts where assignment_id = $1 and share_with_client", 1, [a1]);

const xc = (await expectOk("ops opens an exception with a client message", ops, OX,
  oxArgs(sA.id, { title: "Customs query on HS code", details: "Officer suspects undervaluation (internal)", clientMessage: "Customs asked a question about the cargo; we are answering it today.", clientVisible: true })))?.rows[0]?.id;
const alerts = (await as(cA, "select * from client_shipment_alerts($1)", [sA.id])).rows;
alerts.length === 1 && alerts[0].message.startsWith("Customs asked") && !JSON.stringify(alerts).includes("undervaluation")
  ? ok("client sees the client message only, not internal details") : bad("alerts", JSON.stringify(alerts));
await expectRows("client is notified of the alert", null, "select 1 from notifications where template_key = 'shipment.alert' and recipient_id = $1", 1, [cA]);
await expectRows("other client sees no alerts", cB, "select 1 from client_shipment_alerts($1)", 0, [sA.id]);
const SCM = "select set_exception_client_message($1, $2, $3)";
await expectError("a non-owner cannot message the client", agent, SCM, /Only the owner/, [xc, "Hello", true]);
await expectError("a visible message needs text", ops, SCM, /Write the message/, [xc, "", true]);
await expectOk("ops hides the alert from the client", ops, SCM, [xc, null, false]);
await expectRows("…and it disappears from the portal", cA, "select 1 from client_shipment_alerts($1)", 0, [sA.id]);

const cDoc = "abcdefab-cdef-4abc-8def-abcdefabcdef";
await putFile(pth(cDoc, "packing-list.pdf"), 2048);
await expectError("client upload must be visible to the client", cA, "select * from record_document($1, $2, $3, $4, $5, $6, $7, $8)", /row-level security/,
  [cDoc, sA.id, "packing_list", pth(cDoc, "packing-list.pdf"), "packing-list.pdf", null, null, false]);
await expectOk("client uploads its packing list", cA, rec, [cDoc, sA.id, "packing_list", pth(cDoc, "packing-list.pdf"), "Packing list.pdf", null, null]);
await expectRows("…as pending review, uploaded by the client", null,
  "select 1 from documents where id = $1 and verification_status = 'pending' and uploaded_by = $2 and client_visible", 1, [cDoc, cA]);
await expectRows("responsible staff member is notified", null, "select 1 from notifications where template_key = 'staff.client_uploaded' and recipient_id = $1", 1, [doc]);
await expectError("client cannot review its own upload", cA, "select review_document($1, 'verified')", /not allowed/, [cDoc]);

console.log("\nSender schedule (0016):");
await expectRows("queueing still works when the sender is not configured", null,
  "select private.enqueue_notification('kick-test:1', 'shipment.alert', $1, '{\"message\":\"Kick test\"}'::jsonb, array[$2::uuid]) n", 1, [sA.id, cA]);
await expectOk("the kick is a no-op without Vault secrets", null, "select private.kick_notification_sender()");
await expectError("users cannot trigger the sender", ops, "select private.kick_notification_sender()", /permission denied/);
await expectError("…nor clients", cA, "select private.kick_sender_after_queue()", /permission denied/);
await expectRows("ops manager can read a client's notification (failure diagnosis)", ops,
  "select 1 from notifications where event_key = 'kick-test:1' and recipient_id = $1", 1, [cA]);
await expectRows("…a doc officer cannot", doc, "select 1 from notifications where event_key = 'kick-test:1'", 0);
await expectRows("…nor can ops change it", ops, "update notifications set read_at = now() where event_key = 'kick-test:1' returning 1", 0);

console.log("\nSender pause (0017):");
await db.query("update notification_deliveries set state = 'pending', next_attempt_at = now() where id = (select id from notification_deliveries order by created_at desc limit 1)");
await expectOk("admin pauses outbound sending", admin, "update app_settings set value = 'true' where key = 'notify.sender_paused'");
await expectRows("an ops manager cannot change the switch", ops, "update app_settings set value = 'false' where key = 'notify.sender_paused' returning 1", 0);
(await asService("select count(*)::int n from claim_notification_deliveries(50)")).rows[0].n === 0
  ? ok("paused → the deployed sender claims nothing") : bad("pause", "claimed");
const queuedN = (await db.query("select count(*)::int n from notification_deliveries where state = 'pending' and next_attempt_at <= now()")).rows[0].n;
queuedN >= 1 ? ok(`…deliveries stay queued (${queuedN})`) : bad("queued", "none");
(await asService("select count(*)::int n from claim_notification_deliveries(50, true)")).rows[0].n === queuedN
  ? ok("the test sender can still claim (service role, explicit)") : bad("ignore pause", "none");
await expectError("users cannot claim, paused or not", ops, "select * from claim_notification_deliveries(5, true)", /permission denied/);
await expectOk("admin resumes sending", admin, "update app_settings set value = 'false' where key = 'notify.sender_paused'");
await expectRows("the change is audited", null, "select 1 from audit_log where table_name = 'app_settings' and action = 'UPDATE' and new_data ->> 'key' = 'notify.sender_paused'", 2);

console.log("\nPush device registration (0018):");
const dev = { endpoint: "https://fcm.googleapis.com/fcm/send/shared-phone-1", p256dh: "C".repeat(87), auth: "D".repeat(22) };
const REG = "select register_push_subscription($1, $2, $3, $4)";
await expectOk("client A registers this phone", cA, REG, [dev.endpoint, dev.p256dh, dev.auth, "Android Chrome"]);
await expectOk("…registering again is harmless", cA, REG, [dev.endpoint, dev.p256dh, dev.auth, "Android Chrome"]);
await expectRows("one row for the device", null, "select 1 from push_subscriptions where endpoint = $1", 1, [dev.endpoint]);
await expectOk("client B signs in on the same phone and turns push on", cB, REG, [dev.endpoint, "E".repeat(87), "F".repeat(22), "Android Chrome"]);
await expectRows("the device moved to client B (A no longer gets B's phone)", null,
  "select 1 from push_subscriptions where endpoint = $1 and user_id = $2 and p256dh = $3", 1, [dev.endpoint, cB, "E".repeat(87)]);
await expectRows("client A no longer sees it", cA, "select 1 from push_subscriptions where endpoint = $1", 0, [dev.endpoint]);
await expectRows("client A cannot delete B's device (sign-out of A)", cA, "delete from push_subscriptions where endpoint = $1 returning 1", 0, [dev.endpoint]);
await expectRows("client B removes it on sign-out", cB, "delete from push_subscriptions where endpoint = $1 returning 1", 1, [dev.endpoint]);
await expectError("anonymous cannot register", "anon", REG, /permission denied/, [dev.endpoint, dev.p256dh, dev.auth, null]);
await expectError("plain http refused", ops, REG, /check constraint/, ["http://fcm.googleapis.com/x", dev.p256dh, dev.auth, null]);
for (let i = 0; i < 11; i++) await as(ops, REG, [`https://fcm.googleapis.com/fcm/send/ops-${i}`, dev.p256dh, dev.auth, null]);
await expectRows("at most 10 devices per user (oldest dropped)", null, "select 1 from push_subscriptions where user_id = $1", 10, [ops]);

console.log("\nDriver workspace (0020):");
const driver2 = await user("driver2@ngb.test", "driver", ngb);
const jobs = (await as(driver, "select * from driver_jobs()")).rows;
const jT = jobs.find((j) => j.shipment_id === sT);
jT && jT.assignment_id === a1 && jT.client_name && jT.containers.length === 1 && jT.containers[0].id === t1 && jT.ops_contact_name !== undefined
  ? ok(`driver sees their jobs (${jobs.length}), with client, containers and ops contact`) : bad("driver_jobs", JSON.stringify(jobs).slice(0, 200));
await expectRows("another driver sees none of them", driver2, "select 1 from driver_jobs()", 0);
await expectRows("clients get nothing from driver_jobs", cA, "select 1 from driver_jobs()", 0);
await expectRows("office staff get nothing from driver_jobs", ops, "select 1 from driver_jobs()", 0);
await expectRows("another driver cannot read the shipment", driver2, "select 1 from shipments where id = $1", 0, [sT]);
await expectRows("another driver cannot read the job's events", driver2, "select 1 from driver_job_events($1)", 0, [a1]);
const evs = (await as(driver, "select * from driver_job_events($1)", [a1])).rows;
evs.length >= 2 && evs.every((e) => e.container_number) && evs.some((e) => e.recorded_by_me)
  ? ok(`driver sees the job's events since the truck was assigned (${evs.length})`) : bad("job events", JSON.stringify(evs).slice(0, 200));

await expectRows("driver reads only their own profile", driver, "select 1 from profiles", 1);
await expectRows("driver reads only NGB's organization (no client details)", driver, "select 1 from organizations", 1);
await expectRows("driver cannot read milestone events directly (override reasons)", driver, "select 1 from milestone_events", 0);
await expectRows("driver cannot read internal notes", driver, "select 1 from milestone_internal_notes", 0);
await expectRows("driver cannot read hidden ETA reasons", driver, "select 1 from eta_revisions where not client_visible", 0);
await expectRows("driver cannot read settings or SLA rules", driver, "select 1 from app_settings union all select 1 from sla_rules", 0);
await expectRows("driver sees only their own trucks", driver, "select 1 from transport_assignments where driver_user_id is distinct from $1", 0, [driver]);
await expectRows("…not the cancelled truck of container 2", driver, "select 1 from transport_assignments where shipment_id = $1", 1, [sT]);
await expectRows("office staff still read profiles and organizations", ops, "select 1 from organizations where id = $1", 1, [A]);
await expectRows("client still sees colleagues only", cA, "select 1 from profiles where organization_id <> $1", 0, [A]);

await expectError("driver cannot record for a container that is not on their truck", driver, MS, /on your truck/, msArgs(sT, "update", ago(0.01), { containers: [t2], internal: "x" }));
await expectError("…or a shipment-wide update", driver, MS, /on your truck/, msArgs(sT, "update", ago(0.01), { internal: "x" }));
await expectError("driver notes never go to the client", driver, MS, /staff only/, msArgs(sT, "update", ago(0.01), { containers: [t1], note: "Client: call me" }));

const dPod = "aaaaaaaa-0020-4aaa-8aaa-aaaaaaaaaaa1";
const podPath = `${A}/${sA.id}/${dPod}/pod.jpg`;
await putFile(podPath, 2000, "image/jpeg");
await expectOk("driver uploads a POD photo marked for the client", driver,
  "insert into documents (id, shipment_id, document_type, storage_path, file_name, mime_type, size_bytes, client_visible) values ($1, $2, 'proof_of_delivery', $3, 'pod.jpg', 'image/jpeg', 2000, true)", [dPod, sA.id, podPath]);
await expectRows("…stored hidden from the client until staff publish it", null, "select 1 from documents where id = $1 and not client_visible", 1, [dPod]);
await expectRows("driver sees their own upload", driver, "select 1 from documents where id = $1", 1, [dPod]);
await expectRows("driver does not see commercial or customs documents", driver, "select 1 from documents where document_type in ('bill_of_lading', 'customs_entry', 'commercial_invoice')", 0);
await expectRows("driver can still open their own file in storage", driver, "select 1 from storage.objects where name = $1", 1, [podPath]);
await expectRows("…but not the BL file", driver, "select 1 from storage.objects where name = $1", 0, [pA1]);

await expectError("another driver cannot change this driver's consent", driver2, "select set_my_contact_sharing($1, false)", /not found/, [a1]);
await expectError("clients cannot use the driver consent function", cA, "select set_my_contact_sharing($1, false)", /not allowed/, [a1]);
await expectOk("driver withdraws consent to share their contact", driver, "select set_my_contact_sharing($1, false)", [a1]);
await expectRows("…the client no longer sees the driver contact", cA, "select 1 from client_transport($1) where driver_name is not null", 0, [sT]);
await expectRows("…and the change is audited with the driver as actor", null,
  "select 1 from audit_log where table_name = 'driver_contacts' and actor_id = $1", 1, [driver]);
await expectOk("driver agrees again", driver, "select set_my_contact_sharing($1, true)", [a1]);
await expectRows("…shown again (organization policy is on)", cA, "select 1 from client_transport($1) where driver_name is not null", 1, [sT]);

const RP = "select driver_report_problem($1, $2, $3::uuid[], $4) id";
await expectError("a problem report needs a description", driver, RP, /Describe/, [a1, " ", null, null]);
await expectError("another driver cannot report on this job", driver2, RP, /not found/, [a1, "Flat tyre", null, null]);
await expectError("office staff use exceptions instead", ops, RP, /not allowed/, [a1, "Flat tyre", null, null]);
const rp = await expectOk("driver reports a problem", driver, RP, [a1, "Flat tyre near Kayonza, about 2 hours delay", null, "rp-1"]);
await expectOk("…the same tap again (retry)", driver, RP, [a1, "Flat tyre near Kayonza, about 2 hours delay", null, "rp-1"]);
const rpId = rp?.rows[0]?.id;
await expectRows("recorded once, staff-only, from the driver", null,
  "select 1 from milestone_events where idempotency_key = 'rp-1' and not client_visible and source = 'driver' and public_note is null", 1);
await expectRows("the note reaches staff", ops, "select 1 from milestone_internal_notes where shipment_id = $1 and note like 'Driver report: Flat tyre%'", 1, [sT]);
await expectRows("the ops owner and the coordinator are notified once", null,
  "select 1 from notifications where template_key = 'staff.driver_report' and event_key = $1", 2, ["driver_report:" + rpId]);
await expectRows("the client is not notified", null,
  "select 1 from notifications n join profiles p on p.id = n.recipient_id where n.event_key like 'milestone:%' and p.role = 'client' and n.shipment_id = $1 and n.payload ->> 'milestone' = 'update' and n.created_at > now() - interval '1 minute'", 0, [sT]);

await db.query("update transport_assignments set status = 'cancelled', cancelled_at = now(), cancel_reason = 'test: revoke' where id = $1", [a1]);
await expectRows("a cancelled truck ends the driver's access at once", driver, "select 1 from shipments where id = $1", 0, [sT]);
await expectRows("…and the job disappears", driver, "select 1 from driver_jobs() where assignment_id = $1", 0, [a1]);
await expectError("…and nothing more can be recorded", driver, MS, /not found/, msArgs(sT, "update", ago(0.01), { containers: [t1], internal: "x" }));
await db.query("update transport_assignments set status = 'active', cancelled_at = null, cancel_reason = null where id = $1", [a1]);

console.log("\nFinance (0021, AC-11/12):");
{ // own scope: names below are local to the finance checks
const SD = "select save_invoice_draft($1, $2, $3, $4::jsonb, $5, $6) id";
const lines = (...ls) => JSON.stringify(ls.map(([description, quantity, unit_price, tax_rate]) => ({ description, quantity, unit_price, tax_rate })));
const inv = async (id) => (await db.query("select * from invoices where id = $1", [id])).rows[0];
const finOf = async (ship) => (await db.query("select finance_status from shipments where id = $1", [ship])).rows[0].finance_status;
const yr = new Date().getFullYear();

await expectError("doc officer cannot prepare invoices", doc, SD, /Only finance/, [null, sT, "USD", lines(["Clearing", "1", "100.00", "0"]), null, null]);
await expectError("clients cannot prepare invoices", cA, SD, /Only finance/, [null, sT, "USD", lines(["Clearing", "1", "100.00", "0"]), null, null]);
await expectError("unsupported currency", finance, SD, /currency/, [null, sT, "EUR", lines(["Clearing", "1", "100.00", "0"]), null, null]);
await expectError("prices have at most 2 decimals", finance, SD, /at most 2 decimals/, [null, sT, "USD", lines(["Clearing", "1", "100.005", "0"]), null, null]);
await expectError("quantity must be above zero", finance, SD, /quantities above 0/, [null, sT, "USD", lines(["Clearing", "0", "100.00", "0"]), null, null]);
await expectError("tax rate 0 to 100", finance, SD, /tax rate 0 to 100/, [null, sT, "USD", lines(["Clearing", "1", "100.00", "120"]), null, null]);
await expectError("lines must be a list", finance, SD, /between 1 and 50 lines/, [null, sT, "USD", JSON.stringify({ a: 1 }), null, null]);
const d1 = (await expectOk("finance drafts an invoice: zero-rated transit + taxed local handling", finance, SD,
  [null, sT, "USD", lines(["Road transit Dar → Kigali (zero-rated)", "1", "1500.00", "0"], ["Port handling", "2", "250.50", "18"]),
    "Thank you for your business", "Bank: NGB Logistics (fictional), acc 000-111"]))?.rows[0]?.id;
let I = await inv(d1);
I?.subtotal === "2001.00" && I.tax_total === "90.18" && I.total === "2091.18" && I.invoice_number === null && I.status === "draft" && I.client_id === A
  ? ok("totals computed by the database: 2001.00 + 90.18 tax = 2091.18; no number while draft") : bad("draft totals", JSON.stringify(I));
const r3 = (await expectOk("rounding is per line, half away from zero", finance, SD,
  [null, sT, "USD", lines(["Fuel surcharge", "0.333", "10.00", "18"]), null, null]))?.rows[0]?.id;
I = await inv(r3);
I?.subtotal === "3.33" && I.tax_total === "0.60" && I.total === "3.93" ? ok("…0.333 × 10.00 = 3.33; 18% → 0.60") : bad("rounding", JSON.stringify(I));
await expectRows("clients cannot read invoices", cA, "select 1 from invoices", 0);
await expectRows("…nor other staff (doc officer, agent, driver)", doc, "select 1 from invoices union all select 1 from invoice_lines", 0);
await expectRows("…driver", driver, "select 1 from invoices", 0);
await expectRows("ops manager reads them", ops, "select 1 from invoices where id = $1", 1, [d1]);
await expectError("nobody writes invoices directly", finance, "insert into invoices (client_id, shipment_id, currency) values ($1, $2, 'USD')", /permission denied/, [A, sT]);
await expectError("…or payments", finance, "insert into payments (invoice_id, amount, currency, paid_at, method) values ($1, 1, 'USD', now(), 'cash')", /permission denied/, [d1]);
await expectOk("finance edits the draft (lines replaced)", finance, SD,
  [d1, sT, "USD", lines(["Road transit Dar → Kigali (zero-rated)", "1", "1500.00", "0"], ["Port handling", "2", "250.50", "18"]), null, null]);

const IS = "select issue_invoice($1, $2::date, $3::date) n";
const today = new Date().toISOString().slice(0, 10);
const dayOff = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
await expectError("doc officer cannot issue", doc, IS, /Only finance/, [d1, null, null]);
await expectError("due date before issue date is refused", finance, IS, /due date/, [d1, today, dayOff(-1)]);
const n1 = (await expectOk("finance issues the invoice", finance, IS, [d1, null, null]))?.rows[0]?.n;
n1 === `INV-${yr}-00001` ? ok(`number assigned on issue, gap-free (${n1}) even after a refused attempt`) : bad("number", n1);
I = await inv(d1);
I.status === "issued" && I.balance_due === "2091.18" && I.issued_by === finance && I.due_date && I.issue_date
  ? ok("issued: balance = total, issuer recorded, due date from terms (30 days by default)") : bad("issued", JSON.stringify(I));
(await finOf(sT)) === "invoiced" ? ok("shipment finance status → invoiced") : bad("finance status", await finOf(sT));
await expectError("an issued invoice cannot be edited", finance, SD, /Only a draft/, [d1, sT, "USD", lines(["x", "1", "1.00", "0"]), null, null]);
await expectError("…not even directly by the database owner", null, "update invoices set total = 1, subtotal = 1, tax_total = 0 where id = $1", /cannot be edited/, [d1]);
await expectError("…and its lines are frozen", null, "update invoice_lines set unit_price = 1 where invoice_id = $1", /only change while the invoice is a draft/, [d1]);
await expectError("issuing twice is refused", finance, IS, /already issued/, [d1, null, null]);

const RP = "select record_payment($1, $2::numeric, $3, $4::timestamptz, $5::payment_method, $6, $7) id";
const nowIso = new Date().toISOString();
await expectError("doc officer cannot record payments", doc, RP, /Only finance/, [d1, "100.00", "USD", nowIso, "bank_transfer", "TT-0", null]);
await expectError("a payment in another currency is refused (no mixed currencies)", finance, RP, /in USD/, [d1, "100.00", "RWF", nowIso, "bank_transfer", "TT-0", null]);
await expectError("more than the balance is refused", finance, RP, /more than what is left/, [d1, "2091.19", "USD", nowIso, "bank_transfer", "TT-0", null]);
await expectError("3 decimals refused", finance, RP, /at most 2 decimals/, [d1, "10.005", "USD", nowIso, "bank_transfer", "TT-0", null]);
await expectError("a bank transfer needs its reference", finance, RP, /reference/, [d1, "100.00", "USD", nowIso, "bank_transfer", " ", null]);
await expectError("a payment in the future is refused", finance, RP, /not in the future/, [d1, "100.00", "USD", new Date(Date.now() + 86400e3).toISOString(), "cash", null, null]);
const p1 = (await expectOk("finance records a partial payment (1000.00, bank transfer)", finance, RP, [d1, "1000.00", "USD", nowIso, "bank_transfer", "TT-2026-001", null]))?.rows[0]?.id;
await expectError("the same reference twice is refused (case-insensitive)", finance, RP, /already recorded/, [d1, "10.00", "USD", nowIso, "bank_transfer", "tt-2026-001", null]);
I = await inv(d1);
I.balance_due === "2091.18" && I.status === "issued" ? ok("an unverified payment does not reduce the balance") : bad("pending", JSON.stringify(I));
await expectError("recording cannot exceed balance minus payments awaiting verification", finance, RP, /awaiting verification/, [d1, "1091.19", "USD", nowIso, "cash", null, null]);

const RV = "select review_payment($1, $2::payment_decision, $3) r";
await expectError("admin cannot verify payments (finance only, AC-12)", admin, RV, /Only finance/, [p1, "verified", null]);
await expectError("…nor the ops manager", ops, RV, /Only finance/, [p1, "verified", null]);
const rc1 = (await expectOk("finance verifies the payment", finance, RV, [p1, "verified", null]))?.rows[0]?.r;
rc1 === `RCPT-${yr}-00001` ? ok(`receipt number issued (${rc1})`) : bad("receipt", rc1);
await expectRows("verification records who and when (AC-12)", null,
  "select 1 from payment_reviews r join payments p on p.id = r.payment_id where r.payment_id = $1 and r.reviewed_by = $2 and r.reviewed_at is not null and p.transaction_reference = 'TT-2026-001'", 1, [p1, finance]);
I = await inv(d1);
I.amount_paid === "1000.00" && I.balance_due === "1091.18" && I.status === "partially_paid" ? ok("balance 1091.18, partially paid (AC-11)") : bad("partial", JSON.stringify(I));
(await finOf(sT)) === "partially_paid" ? ok("shipment finance status → partially paid") : bad("finance status", await finOf(sT));
await expectError("a payment is reviewed only once", finance, RV, /already been reviewed/, [p1, "rejected", "oops"]);
await expectError("payments are append-only", null, "update payments set amount = 1 where id = $1", /append-only/, [p1]);
await expectError("…and so are reviews", null, "delete from payment_reviews where payment_id = $1", /append-only/, [p1]);

const p2 = (await expectOk("a mobile-money payment is recorded", finance, RP, [d1, "50.00", "USD", nowIso, "mobile_money", "MM-77", null]))?.rows[0]?.id;
await expectError("rejecting needs a reason", finance, RV, /reason/, [p2, "rejected", null]);
await expectOk("finance rejects it (not received)", finance, RV, [p2, "rejected", "Not on the bank statement"]);
(await inv(d1)).balance_due === "1091.18" ? ok("a rejected payment never counts") : bad("rejected", (await inv(d1)).balance_due);

const CN = "select issue_credit_note($1, $2::numeric, $3, $4) n";
await expectError("credit more than the balance is refused", finance, CN, /more than what is left/, [d1, "1091.19", "USD", "Too much"]);
await expectError("credit in another currency is refused", finance, CN, /USD/, [d1, "10.00", "KES", "Discount"]);
await expectError("doc officer cannot credit", doc, CN, /Only finance/, [d1, "10.00", "USD", "Discount"]);
const cn1 = (await expectOk("finance issues a credit note with a reason", finance, CN, [d1, "91.18", "USD", "Handling fee waived (agreed with ops)"]))?.rows[0]?.n;
I = await inv(d1);
cn1 === `CN-${yr}-00001` && I.amount_credited === "91.18" && I.balance_due === "1000.00" ? ok(`credit note ${cn1}; balance 1000.00`) : bad("credit", JSON.stringify([cn1, I]));
await expectError("credit notes are append-only", null, "update credit_notes set amount = 1", /append-only/);

const DS = "select set_invoice_dispute($1, $2, $3)";
await expectError("doc officer cannot record disputes", doc, DS, /not allowed/, [d1, true, "Client disputes handling"]);
await expectError("a dispute needs a reason", ops, DS, /reason/, [d1, true, ""]);
await expectOk("ops manager records the client's dispute", ops, DS, [d1, true, "Client says handling was charged twice"]);
(await inv(d1)).status === "disputed" && (await finOf(sT)) === "disputed" ? ok("invoice and shipment show disputed") : bad("dispute", (await inv(d1)).status);
await expectOk("finance resolves it with a note", finance, DS, [d1, false, "Explained: two separate moves"]);
await expectRows("…the resolution is in the audit log", null, "select 1 from audit_log where table_name = 'invoice_disputes' and record_id = $1 and new_data ->> 'resolution' like 'Explained%'", 1, [d1]);
(await inv(d1)).status === "partially_paid" ? ok("…back to partially paid") : bad("resolved", (await inv(d1)).status);

const p3 = (await expectOk("final payment recorded", finance, RP, [d1, "1000.00", "USD", nowIso, "bank_transfer", "TT-2026-002", null]))?.rows[0]?.id;
await expectOk("…and verified", finance, RV, [p3, "verified", null]);
I = await inv(d1);
I.status === "paid" && I.balance_due === "0.00" && I.amount_paid === "2000.00" ? ok("paid in full: 2000.00 paid + 91.18 credit = 2091.18") : bad("paid", JSON.stringify(I));
(await finOf(sT)) === "paid" ? ok("shipment finance status → paid") : bad("finance paid", await finOf(sT));
await expectError("no more payments on a paid invoice", finance, RP, /issued, unpaid/, [d1, "1.00", "USD", nowIso, "cash", null, null]);
await expectError("a paid invoice cannot be voided", finance, "select void_invoice($1, $2)", /payments or credit notes/, [d1, "Mistake"]);

await expectOk("a draft can be voided (no number used)", finance, "select void_invoice($1, $2)", [r3, "Drafted by mistake"]);
(await inv(r3)).status === "void" && (await inv(r3)).invoice_number === null ? ok("…void, numberless") : bad("void draft", JSON.stringify(await inv(r3)));
await expectError("a void invoice cannot be issued", finance, IS, /already issued or void/, [r3, null, null]);
const d2 = (await expectOk("overdue case: invoice for client B issued 40 days ago, due 10 days ago", finance, SD,
  [null, sB.id, "RWF", lines(["Storage", "4", "25000.00", "18"]), null, null]))?.rows[0]?.id;
const n2 = (await expectOk("…issued", finance, IS, [d2, dayOff(-40), dayOff(-10)]))?.rows[0]?.n;
n2 === `INV-${yr}-00002` ? ok("next number is sequential (00002)") : bad("seq", n2);
(await inv(d2)).status === "overdue" && (await finOf(sB.id)) === "overdue" ? ok("past due → overdue; shipment shows overdue") : bad("overdue", (await inv(d2)).status);
await expectError("void an issued invoice needs a reason", finance, "select void_invoice($1, $2)", /reason/, [d2, ""]);
await expectRows("client B cannot read its invoice table rows directly (portal uses functions)", cB, "select 1 from invoices", 0);
await expectRows("every finance change is in the audit log", null,
  "select distinct table_name from audit_log where table_name in ('invoices', 'invoice_lines', 'payments', 'payment_reviews', 'credit_notes')", 5);

console.log("\nClient invoices and finance notifications (0022):");
const CI = "select * from client_invoices($1)";
await expectRows("client A sees its issued invoice only (no drafts, no void drafts, not client B's)", cA, "select invoice_number from client_invoices()", 1);
await expectRows("…it is the right one", cA, "select 1 from client_invoices() where invoice_number = $1 and status = 'paid' and total = 2091.18 and balance_due = 0", 1, [n1]);
await expectRows("client B sees only its own (overdue) invoice", cB, "select 1 from client_invoices() where invoice_number = $1 and status = 'overdue'", 1, [n2]);
await expectRows("client B asking for client A's number gets nothing (same as unknown)", cB, CI, 0, [n1]);
await expectRows("…and an unknown number gets nothing", cA, CI, 0, ["INV-1999-00001"]);
await expectRows("lookup ignores case and spaces", cA, CI, 1, [` ${n1.toLowerCase()} `]);
await expectRows("staff get nothing from the client functions (they use the tables)", finance, "select 1 from client_invoices()", 0);
await expectRows("client A reads its invoice lines", cA, "select 1 from client_invoice_lines($1)", 2, [n1]);
await expectRows("client B cannot read client A's lines", cB, "select 1 from client_invoice_lines($1)", 0, [n1]);
await expectRows("payment history: 2 verified payments + 1 credit note; the rejected payment is not shown", cA,
  "select 1 from client_invoice_activity($1)", 3, [n1]);
await expectRows("…verified payments carry their receipt numbers", cA,
  "select 1 from client_invoice_activity($1) where kind = 'payment' and verified and number like 'RCPT-%'", 2, [n1]);
await expectRows("client B cannot read client A's payments", cB, "select 1 from client_invoice_activity($1)", 0, [n1]);
await expectRows("client A opens its receipt", cA, "select 1 from client_receipt($1) where amount = 1000.00 and transaction_reference = 'TT-2026-001'", 1, [rc1]);
await expectRows("client B cannot open client A's receipt", cB, "select 1 from client_receipt($1)", 0, [rc1]);
const cols = (await db.query("select string_agg(array_to_string(proargnames, ','), ',') c from pg_proc where proname in ('client_invoices', 'client_invoice_lines', 'client_invoice_activity', 'client_receipt')")).rows[0].c ?? "";
cols.includes("invoice_number") && !/reason|recorded_by|reviewed_by|,note\b|dispute|void|created_by/.test(cols) ? ok("client functions return no internal fields (reasons, staff, internal notes)") : bad("internal cols", cols);

const notes = (sql, params) => db.query(sql, params).then((r) => r.rows);
const issued = await notes("select recipient_id, payload from notifications where event_key = $1 and template_key = 'invoice.issued'", [`invoice:${d1}:issued`]);
issued.length === 1 && issued[0].recipient_id === cA && issued[0].payload.invoice_number === n1 && issued[0].payload.total === "2091.18"
  && /^\d{4}-\d{2}-\d{2}$/.test(issued[0].payload.due_date ?? "") && issued[0].payload.balance_due === "2091.18"
  ? ok("invoice issued → client A notified once: number, total and balance as exact text, due date")
  : bad("invoice.issued", JSON.stringify(issued));
const ver = await notes("select recipient_id, payload from notifications where event_key = $1", [`payment:${p1}:verified`]);
ver.length === 1 && ver[0].recipient_id === cA && ver[0].payload.amount === "1000.00" && ver[0].payload.balance_due === "1091.18"
  && ver[0].payload.receipt_number === rc1 && ver[0].payload.transaction_reference === "TT-2026-001"
  ? ok("payment verified → amount, reference, balance AFTER the payment (1091.18), receipt number")
  : bad("payment.verified", JSON.stringify(ver));
await expectRows("a rejected payment sends nothing", null, "select 1 from notifications where event_key = $1", 0, [`payment:${p2}:verified`]);
await expectRows("client B was not told about client A's invoice; no staff got client messages", null,
  "select 1 from notifications n join profiles p on p.id = n.recipient_id where n.template_key in ('invoice.issued', 'payment.verified') and (p.organization_id = $1 or p.role <> 'client') and n.shipment_id = $2", 0, [B, sT]);
await expectRows("drafts and void drafts notify nobody", null, "select 1 from notifications where event_key = $1", 0, [`invoice:${r3}:issued`]);
await expectRows("client B notified of its own invoice", null, "select 1 from notifications where event_key = $1 and recipient_id = $2", 1, [`invoice:${d2}:issued`, cB]);

console.log("\nPayment reminders and overdue refresh (0023, AC-13):");
{
const tzB = (await db.query("select timezone from organizations where id = $1", [B])).rows[0].timezone;
const todayB = (await db.query("select ((now() at time zone $1)::date)::text d", [tzB])).rows[0].d;
const dB = (n) => new Date(Date.parse(todayB + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const mk = async (label, issueOff, dueOff, amount = "1000.00") => {
  const id = (await expectOk(`${label}: draft`, finance, SD, [null, sB.id, "RWF", lines(["Storage (fictional)", "1", amount, "0"]), null, null]))?.rows[0]?.id;
  await expectOk(`…issued ${issueOff}d, due ${dueOff}d`, finance, IS, [id, dB(issueOff), dB(dueOff)]);
  return id;
};
const daily = async () => (await db.query("select * from private.finance_daily()")).rows[0];
const sent = async (id) => (await db.query("select stage, days_from_due from invoice_reminders where invoice_id = $1 order by stage", [id])).rows;
const reminderNote = async (id, stage) => (await db.query("select recipient_id, payload from notifications where event_key = $1", [`reminder:${id}:${stage}`])).rows;

(await db.query("select private.reminder_stages()::text s")).rows[0].s === "{-3,0,7,14,30}" ? ok("default stages -3, 0, +7, +14, +30") : bad("stages", "");
await db.query("update app_settings set value = '[5, \"x\", 1.5, -3, 900]' where key = 'finance.reminder_stages'");
(await db.query("select private.reminder_stages()::text s")).rows[0].s === "{-3,5}" ? ok("stage setting: invalid entries ignored") : bad("stages filter", (await db.query("select private.reminder_stages()::text s")).rows[0].s);
await db.query("update app_settings set value = '\"junk\"' where key = 'finance.reminder_stages'");
(await db.query("select private.reminder_stages()::text s")).rows[0].s === "{-3,0,7,14,30}" ? ok("…a broken setting falls back to the defaults") : bad("stages fallback", "");
await db.query("update app_settings set value = '[-3, 0, 7, 14, 30]' where key = 'finance.reminder_stages'");

await expectRows("finance is alerted when an invoice becomes overdue (once)", null,
  "select 1 from notifications where event_key = $1 and template_key = 'staff.invoice_overdue' and recipient_id = $2", 1, [`invoice:${d2}:overdue`, finance]);
await expectRows("finance is alerted when a dispute is opened", null,
  "select 1 from notifications where event_key like $1 and template_key = 'staff.invoice_disputed' and recipient_id = $2 and payload ->> 'reason' like 'Client says%'", 1, [`invoice:${d1}:dispute:%`, finance]);
await expectRows("…clients get no staff alerts", null,
  "select 1 from notifications n join profiles p on p.id = n.recipient_id where n.template_key like 'staff.invoice_%' and p.role = 'client'", 0);

const eSoon = await mk("due in 3 days", -5, 3);
const eToday = await mk("due today", -10, 0);
const eNew = await mk("issued today, due in 2 days", 0, 2);
const eDisp = await mk("16 days overdue but disputed", -20, -16);
await expectOk("…dispute opened", ops, DS, [eDisp, true, "Client queries the rate"]);
const ePend = await mk("8 days overdue, payment awaiting verification covers it", -9, -8);
await expectOk("…full payment recorded (not yet verified)", finance, RP, [ePend, "1000.00", "RWF", nowIso, "mobile_money", "MM-PEND-1", null]);

await expectError("doc officer cannot run reminders", doc, "select * from run_finance_reminders()", /Only finance/);
await expectError("…nor clients", cB, "select * from run_finance_reminders()", /Only finance/);
const r1 = (await expectOk("finance runs the reminders now", finance, "select * from run_finance_reminders()"))?.rows[0];
r1?.reminders >= 3 ? ok(`reminders sent: ${r1.reminders}`) : bad("run", JSON.stringify(r1));
JSON.stringify(await sent(d2)) === JSON.stringify([{ stage: 7, days_from_due: 10 }]) ? ok("10 days overdue → only the +7 stage (no burst of -3 and 0)") : bad("d2 stage", JSON.stringify(await sent(d2)));
(await sent(eSoon))[0]?.stage === -3 ? ok("due in 3 days → the -3 stage") : bad("soon", JSON.stringify(await sent(eSoon)));
(await sent(eToday))[0]?.stage === 0 ? ok("due today → the 0 stage") : bad("today", JSON.stringify(await sent(eToday)));
(await sent(eNew)).length === 0 ? ok("no reminder on the day the invoice was issued") : bad("issue day", JSON.stringify(await sent(eNew)));
(await sent(eDisp)).length === 0 ? ok("never while disputed") : bad("disputed", JSON.stringify(await sent(eDisp)));
(await sent(ePend)).length === 0 ? ok("not when payments awaiting verification cover the balance") : bad("pending", JSON.stringify(await sent(ePend)));
(await sent(d1)).length === 0 ? ok("paid invoices get none") : bad("paid", JSON.stringify(await sent(d1)));
const n7 = await reminderNote(d2, 7);
n7.length === 1 && n7[0].recipient_id === cB && n7[0].payload.days_from_due === 10 && n7[0].payload.balance_due === "118000.00"
  ? ok("client B notified: stage, days overdue and balance as exact text") : bad("reminder note", JSON.stringify(n7));

const again = await daily();
again.reminders === 0 && (await sent(d2)).length === 1 ? ok("a second run sends nothing again (once per stage, AC-13)") : bad("again", JSON.stringify(again));
await expectOk("dispute resolved", finance, DS, [eDisp, false, "Rate confirmed"]);
await daily();
JSON.stringify((await sent(eDisp)).map((r) => r.stage)) === "[14]" ? ok("after the dispute: only the latest stage (+14), not the missed ones") : bad("after dispute", JSON.stringify(await sent(eDisp)));

await db.query("update organizations set payment_reminders = false where id = $1", [B]);
const eOff = await mk("client with reminders turned off, due yesterday", -5, -1);
await daily();
(await sent(eOff)).length === 0 ? ok("no reminders for a client with reminders turned off") : bad("off", JSON.stringify(await sent(eOff)));
await db.query("update organizations set payment_reminders = true where id = $1", [B]);
await daily();
(await sent(eOff))[0]?.stage === 0 ? ok("…turned back on: the stage reached is sent") : bad("on", JSON.stringify(await sent(eOff)));

const eLate = await mk("issued, due in 5 days", -3, 5);
(await inv(eLate)).status === "issued" ? ok("…status issued") : bad("late", (await inv(eLate)).status);
// time passes: move the due date into the past as the database owner (the freeze trigger blocks everyone else)
await db.query("alter table invoices disable trigger invoices_freeze");
await db.query("update invoices set due_date = $2::date where id = $1", [eLate, dB(-1)]);
await db.query("alter table invoices enable trigger invoices_freeze");
const r2 = await daily();
(await inv(eLate)).status === "overdue" && r2.overdue >= 1 ? ok("the daily run moves an invoice past its due date to overdue") : bad("refresh", JSON.stringify([r2, (await inv(eLate)).status]));
await expectRows("…and finance is alerted", null, "select 1 from notifications where event_key = $1", 1, [`invoice:${eLate}:overdue`]);

await expectRows("clients cannot read the reminder log", cB, "select 1 from invoice_reminders", 0);
await expectRows("…nor the doc officer", doc, "select 1 from invoice_reminders", 0);
await expectRows("finance reads it", finance, "select 1 from invoice_reminders where invoice_id = $1", 1, [d2]);
await expectError("nobody writes it directly", finance, "insert into invoice_reminders (invoice_id, stage, days_from_due, balance_due, currency) values ($1, 30, 30, 1, 'RWF')", /permission denied/, [d2]);
await expectError("the reminder log is append-only", null, "delete from invoice_reminders where invoice_id = $1", /append-only/, [d2]);
await expectError("…and unique per invoice and stage", null, "insert into invoice_reminders (invoice_id, stage, days_from_due, balance_due, currency) values ($1, 7, 10, 1, 'RWF')", /duplicate key/, [d2]);
await expectRows("clients cannot change their own reminder setting (RLS: no row updated)", cB, "update organizations set payment_reminders = false where id = $1 returning 1", 0, [B]);
(await db.query("select payment_reminders from organizations where id = $1", [B])).rows[0].payment_reminders === true ? ok("…still on") : bad("client toggled", "");
}

}

console.log("\nSecurity invariants (all migrations):");
const none = async (name, sql) => {
  const rows = (await db.query(sql)).rows;
  rows.length === 0 ? ok(name) : bad(name, JSON.stringify(rows).slice(0, 300));
};
await none("every public table has row-level security on",
  `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`);
await none("no policy lets everyone through (USING/WITH CHECK true)",
  `select schemaname, tablename, policyname from pg_policies where qual = 'true' or with_check = 'true'`);
await none("every SECURITY DEFINER function pins its search_path",
  `select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) x where x like 'search_path=%')`);
await none("anonymous users can call no function in public",
  `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`);
await none("anonymous users have no table privileges in public",
  `select table_name, privilege_type from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'`);
(await db.query("select has_schema_privilege('anon', 'private', 'usage') u")).rows[0].u === false
  ? ok("anonymous users cannot use the private schema") : bad("private schema", "anon has usage");
await none("views in public run with the caller's permissions (security_invoker)",
  `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v' and not coalesce(c.reloptions @> '{security_invoker=true}', false)`);
// Signed-in users may run private helpers only if they are read-only (policy helpers) or trigger functions.
// Allow-listed: next_shipment_reference (column default used by register_shipment; misuse only skips a number).
await none("private functions callable by signed-in users are read-only helpers or triggers",
  `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and has_function_privilege('authenticated', p.oid, 'execute')
      and p.provolatile = 'v' and p.prorettype <> 'trigger'::regtype
      and p.proname not in ('next_shipment_reference')`);
await none("sender-only functions are not callable by signed-in users",
  `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('claim_notification_deliveries', 'complete_notification_delivery')
      and has_function_privilege('authenticated', p.oid, 'execute')`);
await none("append-only tables cannot be updated or deleted by signed-in users",
  `select table_name, privilege_type from information_schema.role_table_grants
    where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('UPDATE', 'DELETE')
      and table_name in ('milestone_events', 'audit_log', 'eta_revisions', 'exception_updates', 'notification_delivery_attempts',
                         'payments', 'payment_reviews', 'credit_notes', 'invoices', 'invoice_lines')`);

console.log("\nProfile sync:");
await expectRows("user with no profile sees no shipments", nobody, "select id from shipments", 0);
await db.query("update auth.users set raw_app_meta_data = raw_app_meta_data || $2::jsonb where id = $1",
  [agent, JSON.stringify({ role: "finance", organization_id: ngb })]);
await expectRows("role change in app metadata syncs to profile", null,
  "select 1 from profiles where id = $1 and role = 'finance'", 1, [agent]);
const totalShips = (await db.query("select count(*)::int n from shipments")).rows[0].n;
await expectRows("…and the new role takes effect (finance sees all shipments)", agent, "select id from shipments", totalShips);

console.log("\nDeactivated users:");
await db.query("update profiles set is_active = false where id = $1", [cA]);
await expectRows("deactivated client sees no shipments", cA, "select id from shipments", 0);
await expectRows("deactivated client sees no files", cA, "select name from storage.objects", 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
