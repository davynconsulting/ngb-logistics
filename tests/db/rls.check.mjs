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
await expectError("client cannot upload document rows", cA, insDoc, /row-level security/,
  ["55555555-5555-4555-8555-555555555555", sA.id, "other", `${A}/${sA.id}/55555555-5555-4555-8555-555555555555/x.pdf`, "x.pdf", true]);
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
await expectError("client cannot upload files", cA,
  "insert into storage.objects (bucket_id, name) values ('shipment-documents', $1)", /row-level security/, [`${A}/${sA.id}/x/y.pdf`]);
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
await expectError("client cannot record documents", cA, rec, /row-level security/, [D(5), sA.id, "other", pth(D(5), "x.pdf"), "x.pdf", null, null]);
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
await expectRows("client A sees the confirmation", cA, "select 1 from milestone_events where shipment_id = $1", 1, [sA.id]);
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
await ms("transport coordinator assigns trucks", transport, sA.id, "truck_assigned", ago(50), { containers: [c1, c2] });
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
await msErr("driver cannot record port milestones", driver, sA.id, "ready_for_dispatch", ago(5), { containers: [c1] }, /cannot record/);
await ms("driver records a border checkpoint", driver, sA.id, "arrived_at_border", ago(10), { containers: [c1], location: "Rusumo" });
await ms("driver records arrival", driver, sA.id, "arrived", ago(5), { containers: [c1], internal: "Gate guard asked for extra copy", visible: true });
await expectRows("driver events are marked as driver source", null, "select 1 from milestone_events where source = 'driver'", 2);
await expectRows("staff see the internal note", ops, "select 1 from milestone_internal_notes where shipment_id = $1", 1, [sA.id]);
await expectRows("client sees no internal notes", cA, "select 1 from milestone_internal_notes", 0);
await ms("hidden update for staff only", ops, sA.id, "update", ago(4), { note: "Checking demurrage", visible: false });
await expectRows("hidden update is suppressed for notification", null, "select 1 from milestone_events where milestone_type = 'update' and notification_state = 'suppressed'", 1);
const clientCount = (await as(cA, "select count(*)::int n from milestone_events")).rows[0].n;
const staffCount = (await as(ops, "select count(*)::int n from milestone_events where shipment_id = $1", [sA.id])).rows[0].n;
clientCount === staffCount - 1 ? ok("client does not see the hidden update") : bad("visibility", `${clientCount} vs ${staffCount}`);

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
await expectRows("timeline shows it cancelled, with reason", cA, "select 1 from milestone_timeline where id = $1 and is_voided and void_reason like 'Truck%'", 1, [evGate2]);
await expectError("cannot cancel twice", ops, CM, /already been cancelled/, [evGate2, "again", true, null, null, null]);
await ms("container 2 gate-out recorded again, normally", transport, sA.id, "gate_out", ago(3), { containers: [c2], location: "Dar ICD" });

console.log("\nAwaiting documents:");
await ms("doc officer confirms the registered shipment with missing documents", doc, newId, "shipment_confirmed", ago(2));
(await statusOf(newId)).overall_status === "awaiting_documents" ? ok("missing documents → awaiting documents") : bad("awaiting", (await statusOf(newId)).overall_status);

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
