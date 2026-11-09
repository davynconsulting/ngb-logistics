/**
 * Backup drill, step 1: logical export of the DEV project (Sprint 5, Task 4).
 *
 *   npm run backup:export            → backups/<UTC timestamp>/
 *
 * Read-only: uses the service role over the API (no database password, no
 * Docker, no pg_dump) and changes nothing on the project. Exports:
 *   • every public table, as the exact JSON PostgREST returns (numeric values
 *     are written byte-for-byte, never re-serialised through JS floats)
 *   • auth users: id, e-mail, app/user metadata (no password hashes: the API
 *     never returns them, so restored users must reset their password)
 *   • every file in the private storage bucket, with its SHA-256
 *   • manifest.json: row counts and SHA-256 of every table file and object
 *
 * NOT exported (rebuilt by the restore check, see docs/backup-restore.md):
 * private.shipment_reference_counters (not exposed through the API).
 *
 * The folder holds personal data (names, phones, documents): it is gitignored,
 * created owner-only (0700), and must never be committed or uploaded.
 * Refuses to run against any project other than dev unless --project-ref
 * names the target explicitly (a deliberate step for a future staging drill).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEV_PROJECT_REF = "idyydcuihxkyitylkugo";
const BUCKET = "shipment-documents";
const PAGE = 1000;

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const refArg = process.argv.includes("--project-ref") ? process.argv[process.argv.indexOf("--project-ref") + 1] : DEV_PROJECT_REF;
if (!url.includes(`${refArg}.`)) {
  console.error(`Refusing to export: NEXT_PUBLIC_SUPABASE_URL is not project ${refArg}.`);
  process.exit(1);
}
if (!key) { console.error("SUPABASE_SERVICE_ROLE_KEY is missing from .env.local"); process.exit(1); }

const headers = { apikey: key, Authorization: `Bearer ${key}` };
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Public tables, from the migrations (the schema's source of truth). */
function tablesFromMigrations() {
  const dir = "supabase/migrations";
  const names = new Set();
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const m of fs.readFileSync(path.join(dir, f), "utf8").matchAll(/create table (?:if not exists )?public\.([a-z_][a-z0-9_]*)/g)) names.add(m[1]);
  }
  return [...names].sort();
}

async function get(pathname, extra = {}) {
  const res = await fetch(`${url}${pathname}`, { headers: { ...headers, ...extra }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${pathname.split("?")[0]} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

/** A whole table as one JSON array, pages joined textually (values untouched). */
async function exportTable(table, orderBy) {
  const parts = [];
  let total = null, got = 0;
  for (let from = 0; ; from += PAGE) {
    const res = await get(`/rest/v1/${table}?select=*&order=${orderBy}`, {
      Range: `${from}-${from + PAGE - 1}`, "Range-Unit": "items", Prefer: "count=exact",
    });
    total ??= Number((res.headers.get("content-range") ?? "*/0").split("/")[1]);
    const text = (await res.text()).trim();
    const n = JSON.parse(text).length;           // parsed only to count; the text is what is saved
    if (n) parts.push(text.slice(1, -1));
    got += n;
    if (n < PAGE) break;
  }
  if (got !== total) throw new Error(`${table}: read ${got} rows but the table has ${total} (changed during export?)`);
  return { text: `[${parts.join(",")}]`, rows: got };
}

async function orderColumn(table) {
  // a stable order for paging: the id, or every column for tables without one
  const res = await get(`/rest/v1/${table}?select=*&limit=1`);
  const [row] = await res.json();
  return !row || Object.hasOwn(row, "id") ? "id.asc" : Object.keys(row).map((c) => `${c}.asc`).join(",");
}

async function listObjects(prefix = "") {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const res = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: "name", order: "asc" } }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`storage list ${prefix} → HTTP ${res.status}`);
    const items = await res.json();
    for (const it of items) {
      const full = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id === null) out.push(...(await listObjects(full)));     // a folder
      else out.push({ name: full, size: it.metadata?.size ?? null, mimetype: it.metadata?.mimetype ?? null });
    }
    if (items.length < 100) break;
  }
  return out;
}

const started = Date.now();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = path.join("backups", stamp);
fs.mkdirSync(path.join(out, "tables"), { recursive: true, mode: 0o700 });
fs.chmodSync("backups", 0o700);

const manifest = {
  format: "ngb-logical-backup/1", project_ref: refArg, started_at: new Date(started).toISOString(),
  migrations: fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort(),
  tables: {}, auth_users: null, storage: { bucket: BUCKET, objects: [] }, not_included: ["private.shipment_reference_counters", "auth password hashes"],
};

console.log(`Exporting ${refArg} → ${out}`);
for (const t of tablesFromMigrations()) {
  const { text, rows } = await exportTable(t, await orderColumn(t));
  fs.writeFileSync(path.join(out, "tables", `${t}.json`), text, { mode: 0o600 });
  manifest.tables[t] = { rows, sha256: sha256(text) };
  console.log(`  ${t.padEnd(34)} ${String(rows).padStart(6)} rows`);
}

const users = [];
for (let page = 1; ; page++) {
  const res = await get(`/auth/v1/admin/users?page=${page}&per_page=200`);
  const body = await res.json();
  const batch = body.users ?? [];
  users.push(...batch.map((u) => ({ id: u.id, email: u.email, raw_app_meta_data: u.app_metadata ?? {}, raw_user_meta_data: u.user_metadata ?? {},
    created_at: u.created_at, last_sign_in_at: u.last_sign_in_at ?? null })));
  if (batch.length < 200) break;
}
const usersText = JSON.stringify(users);
fs.writeFileSync(path.join(out, "auth-users.json"), usersText, { mode: 0o600 });
manifest.auth_users = { rows: users.length, sha256: sha256(usersText) };
console.log(`  ${"auth users".padEnd(34)} ${String(users.length).padStart(6)}`);

let bytes = 0;
const queue = await listObjects();
async function download(o) {
  const res = await get(`/storage/v1/object/${BUCKET}/${o.name.split("/").map(encodeURIComponent).join("/")}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const file = path.join(out, "storage", BUCKET, ...o.name.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, buf, { mode: 0o600 });
  bytes += buf.length;
  return { ...o, bytes: buf.length, sha256: sha256(buf) };
}
const results = new Array(queue.length);
let next = 0;
await Promise.all(Array.from({ length: 8 }, async () => {     // 8 downloads at a time
  while (next < queue.length) { const i = next++; results[i] = await download(queue[i]); }
}));
manifest.storage.objects = results;
console.log(`  ${"storage objects".padEnd(34)} ${String(manifest.storage.objects.length).padStart(6)} (${(bytes / 1024).toFixed(0)} KiB)`);

manifest.finished_at = new Date().toISOString();
manifest.duration_ms = Date.now() - started;
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
console.log(`Done in ${(manifest.duration_ms / 1000).toFixed(1)} s. Check it with: npm run backup:restore-check -- ${out}`);
