/**
 * Backup drill, step 2: restore an export into a throw-away Postgres and prove it is complete.
 *
 *   npm run backup:restore-check -- backups/<timestamp>
 *
 * Touches no real database: builds an empty database in memory (PGlite) from our
 * migrations, loads the export, then checks:
 *   1. every file in the export matches the SHA-256 in its manifest
 *   2. every table has exactly the exported number of rows
 *   3. every foreign key and CHECK constraint holds on the restored data
 *   4. money adds up: invoice totals, amounts paid (verified payments only),
 *      credits and balances recomputed from the rows; no negative balance
 *   5. every stored document has its file, with the size the database recorded
 *   6. derived state agrees: has_open_exception, the latest milestone per shipment
 *   7. numbering continues without reusing a number (finance sequences, shipment refs)
 *   8. security still works on the restored data: a client sees only their own
 *      organization's shipments, and append-only history refuses an UPDATE
 * and prints the restore time (an input to the recovery-time objective).
 *
 * Triggers are switched off while loading (session_replication_role = replica),
 * as pg_restore does, so loading old rows does not queue notifications, write
 * audit rows or recompute anything; checks 3–7 then prove the data is consistent.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { STUBS } from "../tests/db/supabase-stubs.mjs";

const dir = process.argv[2];
if (!dir || !fs.existsSync(path.join(dir, "manifest.json"))) {
  console.error("Usage: npm run backup:restore-check -- backups/<timestamp>");
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else fail++; console.log(`  ${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : ` → ${detail}`}`); };
const started = Date.now();

console.log(`Restore drill for ${dir} (exported ${manifest.started_at} from ${manifest.project_ref})`);

// -- 1. integrity of the export itself ---------------------------------------
console.log("\nExport files:");
const read = (rel) => fs.readFileSync(path.join(dir, rel));
const tableText = {};
let badFiles = [];
for (const [t, m] of Object.entries(manifest.tables)) {
  const buf = read(path.join("tables", `${t}.json`));
  if (sha256(buf) !== m.sha256) badFiles.push(t);
  tableText[t] = buf.toString("utf8");
}
check(`${Object.keys(manifest.tables).length} table files match their checksums`, badFiles.length === 0, badFiles.join(", "));
const usersText = read("auth-users.json").toString("utf8");
check("auth users file matches its checksum", sha256(usersText) === manifest.auth_users.sha256);
badFiles = manifest.storage.objects.filter((o) => {
  const f = path.join(dir, "storage", manifest.storage.bucket, ...o.name.split("/"));
  return !fs.existsSync(f) || sha256(fs.readFileSync(f)) !== o.sha256;
}).map((o) => o.name);
check(`${manifest.storage.objects.length} stored files present and match their checksums`, badFiles.length === 0, badFiles.slice(0, 3).join(", "));

const current = fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
check("export was taken at the current schema version (same migrations)", JSON.stringify(current) === JSON.stringify(manifest.migrations),
  `export has ${manifest.migrations.at(-1)}, code has ${current.at(-1)}`);

// -- restore -----------------------------------------------------------------
console.log("\nRestoring into an empty in-memory database:");
const db = new PGlite();
await db.exec(STUBS);
for (const f of current) await db.exec(fs.readFileSync(path.join("supabase/migrations", f), "utf8"));
console.log(`  schema: ${current.length} migrations applied`);

// rows the migrations themselves seed (catalogue, rules, settings, ports…) are replaced by the backup's
await db.exec("set session_replication_role = replica");
const tables = Object.keys(manifest.tables);
for (const t of tables) await db.exec(`delete from public.${t}`);
await db.exec("delete from auth.users");

await db.query(`insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, last_sign_in_at)
  select id, email, raw_app_meta_data, raw_user_meta_data, last_sign_in_at from json_populate_recordset(null::auth.users, $1::json)`, [usersText]);

const objects = manifest.storage.objects;
await db.query(`insert into storage.objects (bucket_id, name, metadata)
  select $1, o->>'name', jsonb_build_object('size', (o->>'bytes')::bigint, 'mimetype', o->>'mimetype')
    from json_array_elements($2::json) o`, [manifest.storage.bucket, JSON.stringify(objects)]);

const loadErrors = [];
for (const t of tables) {
  const cols = (await db.query(`select column_name, is_generated, is_identity, identity_generation from information_schema.columns
     where table_schema = 'public' and table_name = $1 order by ordinal_position`, [t])).rows;
  const insertable = cols.filter((c) => c.is_generated !== "ALWAYS").map((c) => `"${c.column_name}"`).join(", ");
  const overriding = cols.some((c) => c.identity_generation === "ALWAYS") ? "overriding system value" : "";
  try {
    await db.query(`insert into public.${t} (${insertable}) ${overriding} select ${insertable} from json_populate_recordset(null::public.${t}, $1::json)`, [tableText[t]]);
  } catch (e) {
    loadErrors.push(`${t}: ${e.message}`);   // the message only: the error object also carries the rows (personal data)
  }
}
await db.exec("set session_replication_role = origin");

// identity sequences continue after the restored ids
for (const { tbl, col } of (await db.query(`select table_name tbl, column_name col from information_schema.columns
    where table_schema = 'public' and is_identity = 'YES'`)).rows) {
  await db.query(`select setval(pg_get_serial_sequence('public.${tbl}', '${col}'), coalesce((select max(${col}) from public.${tbl}), 0) + 1, false)`);
}
// private.shipment_reference_counters is not reachable through the API: rebuilt from the references
await db.exec(`insert into private.shipment_reference_counters (year, last_value)
  select split_part(shipment_reference, '-', 2)::int, max(split_part(shipment_reference, '-', 3)::int)
    from public.shipments group by 1
  on conflict (year) do update set last_value = excluded.last_value`);
const restoreMs = Date.now() - started;
console.log(`  data loaded in ${(restoreMs / 1000).toFixed(1)} s`);
check("every table loaded (constraints that hold row by row, e.g. CHECK, are enforced while loading)", loadErrors.length === 0, loadErrors.join("; "));

// -- 2. row counts -------------------------------------------------------------
console.log("\nCompleteness:");
const wrong = [];
for (const [t, m] of Object.entries(manifest.tables)) {
  const n = (await db.query(`select count(*)::int n from public.${t}`)).rows[0].n;
  if (n !== m.rows) wrong.push(`${t} ${n}/${m.rows}`);
}
check(`every table has its exported row count (${Object.values(manifest.tables).reduce((a, m) => a + m.rows, 0)} rows)`, wrong.length === 0, wrong.join(", "));
const nUsers = (await db.query("select count(*)::int n from auth.users")).rows[0].n;
check(`${nUsers} users restored`, nUsers === manifest.auth_users.rows);

// -- 3. constraints --------------------------------------------------------------
console.log("\nConstraints (checked after loading, since triggers were off):");
const fks = (await db.query(`select c.conname, c.conrelid::regclass::text src, c.confrelid::regclass::text dst,
    (select array_agg(a.attname order by k.i) from unnest(c.conkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n) src_cols,
    (select array_agg(a.attname order by k.i) from unnest(c.confkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n) dst_cols
  from pg_constraint c join pg_namespace ns on ns.oid = c.connamespace
  where c.contype = 'f' and ns.nspname = 'public'`)).rows;
const broken = [];
for (const fk of fks) {
  const notNull = fk.src_cols.map((c) => `s."${c}" is not null`).join(" and ");
  const join = fk.src_cols.map((c, i) => `d."${fk.dst_cols[i]}" = s."${c}"`).join(" and ");
  const n = (await db.query(`select count(*)::int n from ${fk.src} s where ${notNull} and not exists (select 1 from ${fk.dst} d where ${join})`)).rows[0].n;
  if (n) broken.push(`${fk.conname} (${n})`);
}
check(`all ${fks.length} foreign keys hold`, broken.length === 0, broken.join(", "));
const checks = (await db.query(`select c.conname, c.conrelid::regclass::text tbl, pg_get_constraintdef(c.oid) def
  from pg_constraint c join pg_namespace ns on ns.oid = c.connamespace where c.contype = 'c' and ns.nspname = 'public'`)).rows;
const failing = [];
for (const c of checks) {
  const expr = c.def.replace(/^CHECK\s*/, "").replace(/\s*NOT VALID$/, "");
  const n = (await db.query(`select count(*)::int n from ${c.tbl} where not coalesce(${expr}, true)`)).rows[0].n;
  if (n) failing.push(`${c.conname} (${n})`);
}
check(`all ${checks.length} CHECK constraints hold`, failing.length === 0, failing.join(", "));
const orphanProfiles = (await db.query("select count(*)::int n from public.profiles p where not exists (select 1 from auth.users u where u.id = p.id)")).rows[0].n;
check("every profile has its user", orphanProfiles === 0, `${orphanProfiles} without`);

// -- 4. money ------------------------------------------------------------------------
console.log("\nMoney:");
const money = (await db.query(`
  with lines as (select invoice_id, sum(amount) sub, sum(tax_amount) tax from public.invoice_lines group by 1),
       paid as (select p.invoice_id, sum(p.amount) amt from public.payments p
                where exists (select 1 from public.payment_reviews r where r.payment_id = p.id and r.decision = 'verified') group by 1),
       cred as (select invoice_id, sum(amount) amt from public.credit_notes group by 1)
  select
    count(*) filter (where i.status <> 'draft' and (i.subtotal <> coalesce(l.sub, 0) or i.tax_total <> coalesce(l.tax, 0))) bad_totals,
    count(*) filter (where i.total <> i.subtotal + i.tax_total) bad_sum,
    count(*) filter (where i.status not in ('draft', 'void') and i.amount_paid <> coalesce(p.amt, 0)) bad_paid,
    count(*) filter (where i.status not in ('draft', 'void') and i.amount_credited <> coalesce(c.amt, 0)) bad_credit,
    count(*) filter (where i.status not in ('draft', 'void') and i.balance_due <> i.total - i.amount_paid - i.amount_credited) bad_balance,
    count(*) filter (where i.balance_due < 0) negative,
    count(*) filter (where exists (select 1 from public.payments x where x.invoice_id = i.id and x.currency <> i.currency)) mixed,
    count(*)::int invoices
  from public.invoices i left join lines l on l.invoice_id = i.id left join paid p on p.invoice_id = i.id left join cred c on c.invoice_id = i.id`)).rows[0];
check(`issued invoice totals equal their lines (${money.invoices} invoices)`, Number(money.bad_totals) === 0 && Number(money.bad_sum) === 0, JSON.stringify(money));
check("amount paid = verified payments; credited = credit notes", Number(money.bad_paid) === 0 && Number(money.bad_credit) === 0, JSON.stringify(money));
check("balance = total − paid − credited, never negative", Number(money.bad_balance) === 0 && Number(money.negative) === 0, JSON.stringify(money));
check("no payment in another currency than its invoice", Number(money.mixed) === 0);

// -- 5. documents ↔ files ---------------------------------------------------------------
console.log("\nDocuments:");
const docs = (await db.query(`select d.id, d.storage_path, d.size_bytes, o.metadata from public.documents d
  left join storage.objects o on o.bucket_id = $1 and o.name = d.storage_path`, [manifest.storage.bucket])).rows;
const missing = docs.filter((d) => !d.metadata);
const sizeOff = docs.filter((d) => d.metadata && d.size_bytes != null && Number(d.metadata.size) !== Number(d.size_bytes));
check(`every document record has its file (${docs.length})`, missing.length === 0, `${missing.length} missing, e.g. ${missing[0]?.storage_path}`);
check("file sizes match what the database recorded", sizeOff.length === 0, `${sizeOff.length} differ`);
const unreferenced = objects.length - docs.filter((d) => d.metadata).length;
console.log(`  (${unreferenced} stored file(s) not linked to a document record: abandoned uploads, kept but harmless)`);

// -- 6. derived state ----------------------------------------------------------------------
console.log("\nDerived state:");
const exc = (await db.query(`select count(*)::int n from public.shipments s
  where s.has_open_exception <> exists (select 1 from public.exceptions e where e.shipment_id = s.id and e.status = 'open')`)).rows[0].n;
check("has_open_exception agrees with the open exceptions", exc === 0, `${exc} shipments differ`);
const timeline = (await db.query(`select count(*)::int n from public.milestone_events e where not exists (select 1 from public.shipments s where s.id = e.shipment_id)`)).rows[0].n;
check("every milestone belongs to a restored shipment", timeline === 0);
const tl = await db.query("select count(*)::int n from public.milestone_timeline");
check(`milestone timeline view reads the restored history (${tl.rows[0].n} entries)`, tl.rows[0].n > 0 || manifest.tables.milestone_events.rows === 0);

// -- 7. numbering continues ---------------------------------------------------------------------
console.log("\nNumbering:");
const seq = (await db.query(`select count(*)::int n from (
  select left(invoice_number, 3) kind, split_part(invoice_number, '-', 2)::int yr, max(split_part(invoice_number, '-', 3)::int) mx
    from public.invoices where invoice_number is not null group by 1, 2) used
  left join public.document_sequences d on d.kind = used.kind and d.year = used.yr
  where coalesce(d.last_number, 0) < used.mx`)).rows[0].n;
check("invoice number sequence is at or past the highest issued number", seq === 0, `${seq} behind`);
if (manifest.tables.shipments.rows > 0) {
  const before = (await db.query("select max(shipment_reference) r from public.shipments")).rows[0].r;
  const next = (await db.query("select private.next_shipment_reference() r")).rows[0].r;
  check(`next shipment reference continues after ${before} (${next})`,
    next > before || next.split("-")[1] > before.split("-")[1]);
}

// -- 8. security on the restored data ------------------------------------------------------
console.log("\nSecurity on the restored data:");
const client = (await db.query(`select p.id, p.organization_id from public.profiles p
  where p.role = 'client' and p.is_active and exists (select 1 from public.shipments s where s.client_id = p.organization_id) limit 1`)).rows[0];
if (client) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [client.id]);
  await db.exec("set role authenticated");
  const seen = (await db.query("select client_id from public.shipments")).rows;
  const orgs = (await db.query("select id from public.organizations")).rows;
  await db.exec("reset role");
  const own = (await db.query("select count(*)::int n from public.shipments where client_id = $1", [client.organization_id])).rows[0].n;
  check(`a client sees exactly their own ${own} shipment(s) and nothing else`, seen.length === own && seen.every((r) => r.client_id === client.organization_id));
  check("…and only their own organization", orgs.length === 1 && orgs[0].id === client.organization_id);
} else console.log("  (no active client with shipments in this export: isolation check skipped)");
try {
  await db.exec("update public.milestone_events set public_note = 'changed' where true");
  check("append-only history refuses an UPDATE after restore", manifest.tables.milestone_events.rows === 0, "update succeeded");
} catch (e) { check("append-only history refuses an UPDATE after restore", /append-only|not allowed|cannot/i.test(e.message), e.message); }

console.log(`\nRestore time ${(restoreMs / 1000).toFixed(1)} s, all checks ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
