// Sprint 5 security pass, role by role, against the dev project with REAL user tokens (no service role
// on the user side). Read-only except refused calls: every write attempted here is one that must fail.
//
//  A. Every table and view, read as two clients, the driver and the clearing agent: each returned row
//     must belong to that user (own organization, own or assigned shipments, own notifications) or be
//     a reference table on the allowlist.
//  B. Every database function, called with null arguments: refused to signed-out users; for clients,
//     the driver and the agent, only the functions meant for them return rows.
//  C. Every server action, sent by each role its guard does not allow, on the page it belongs to:
//     redirected before any work. Sending an action to a page it does not belong to runs nothing.
//  D. Guessing another client's identifiers: shipment reference, invoice and receipt numbers,
//     document ids and storage paths, notification ids.
import fs from "node:fs";
import { APP, ANON, URL_, action, actionId, check, createClient, encodeReply, finish, get, login, pageText, svc } from "./_shared.mjs";

console.log("Security pass:");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const spec = await (await fetch(URL_ + "/rest/v1/", { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: "application/openapi+json" } })).json();
const TABLES = Object.keys(spec.definitions ?? {}).sort();
const RPCS = Object.entries(spec.paths).filter(([p]) => p.startsWith("/rpc/")).map(([p, v]) => {
  const body = (v.post?.parameters ?? []).find((x) => x.in === "body");
  return { name: p.slice(5), args: Object.fromEntries(Object.keys(body?.schema?.properties ?? {}).map((k) => [k, null])) };
});

const ROLE_EMAIL = {
  admin: "admin@ngb.example", ops_manager: "ops.manager@ngb.example", doc_officer: "doc.officer@ngb.example",
  clearing_agent: "clearing.agent@ngb.example", transport_coord: "transport@ngb.example", driver: "driver@ngb.example",
  finance: "finance@ngb.example", client: "aline@akagera.example",
};
const U = {};
for (const [role, email] of Object.entries(ROLE_EMAIL)) U[role] = await login(email);
const jean = await login("jean@kivuhardware.example");
const anon = createClient(URL_, ANON, { auth: { persistSession: false } });

// ---- reference data (service role, all rows, paged past the 1000-row API limit) ----
async function all(table, cols) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await svc.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
const idMap = (rows, k = "shipment_id") => new Map(rows.map((r) => [r.id, r[k]]));
const [orgs, , ships, conts, invs, notes, tAssign, sAssign, events, incs, excs, docs] = await Promise.all([
  all("organizations", "id, client_code, is_internal"), all("profiles", "id, role, organization_id"),
  all("shipments", "id, client_id, shipment_reference"), all("containers", "id, shipment_id"), all("invoices", "id, shipment_id, invoice_number, client_id"),
  all("notifications", "id, recipient_id, shipment_id, read_at"), all("transport_assignments", "id, shipment_id, driver_user_id"),
  all("shipment_assignments", "shipment_id, user_id"), all("milestone_events", "id, shipment_id"), all("incidents", "id, shipment_id"),
  all("exceptions", "id, shipment_id"), all("documents", "id, shipment_id, storage_path, client_visible"),
]);
const shipOf = {
  container_id: idMap(conts), invoice_id: idMap(invs), assignment_id: idMap(tAssign), incident_id: idMap(incs),
  exception_id: idMap(excs), event_id: idMap(events), milestone_event_id: idMap(events), document_id: idMap(docs),
};
const recipientOf = idMap(notes, "recipient_id");
const shipClient = idMap(ships, "client_id");
const internalOrg = orgs.find((o) => o.is_internal).id;
const orgByCode = (c) => orgs.find((o) => o.client_code === c).id;
const meId = async (who) => (await who.api.auth.getUser()).data.user.id;

// ---- A. row attribution ----
const REFERENCE = {
  client: ["milestone_catalogue", "notification_rules", "ports"],
  driver: ["milestone_catalogue", "notification_rules", "ports", "routes"],
  agent: ["app_settings", "milestone_catalogue", "notification_rules", "ports", "routes", "sla_rules"],
};
function linkedShipment(table, r) {
  if (table === "shipments") return r.id;
  if (r.shipment_id) return r.shipment_id;
  for (const [k, m] of Object.entries(shipOf)) if (r[k] && m.has(r[k])) return m.get(r[k]);
  return undefined;
}
async function attribution(label, who, kind, allowedShips, allowedOrgs, profileOk) {
  const uid = await meId(who);
  const leaks = [];
  for (const t of TABLES) {
    const { data, error } = await who.api.from(t).select("*").limit(1000);
    if (error || !data?.length) continue;
    const bad = data.filter((r) => {
      if (t === "notifications") return r.recipient_id !== uid;
      if (t === "notification_deliveries") return recipientOf.get(r.notification_id) !== uid;
      if (t === "organizations") return !allowedOrgs.has(r.id);
      if (t === "profiles") return !(r.id === uid || profileOk(r));
      if (t === "notification_preferences" || t === "push_subscriptions") return r.user_id !== uid;
      const s = linkedShipment(t, r);
      if (s !== undefined) return !allowedShips.has(s);
      if (r.user_id) return r.user_id !== uid;
      return !REFERENCE[kind].includes(t);
    });
    if (bad.length) leaks.push(`${t} (${bad.length} of ${data.length})`);
  }
  check(`${label}: every row it can read is its own or reference data`, leaks.length === 0, leaks.join(", "));
}

const A = orgByCode("AKAGERA"), K = orgByCode("KIVU");
const shipsOf = (org) => new Set(ships.filter((s) => s.client_id === org).map((s) => s.id));
await attribution("client (Akagera)", U.client, "client", shipsOf(A), new Set([A]), (p) => p.organization_id === A);
await attribution("client (Kivu Hardware)", jean, "client", shipsOf(K), new Set([K]), (p) => p.organization_id === K);
const driverId = await meId(U.driver);
const driverShips = new Set([...tAssign.filter((a) => a.driver_user_id === driverId).map((a) => a.shipment_id),
  ...sAssign.filter((a) => a.user_id === driverId).map((a) => a.shipment_id)]);
await attribution("driver", U.driver, "driver", driverShips, new Set([internalOrg]), () => false);
const agentId = await meId(U.clearing_agent);
const agentShips = new Set(sAssign.filter((a) => a.user_id === agentId).map((a) => a.shipment_id));
const agentOrgs = new Set([internalOrg, ...[...agentShips].map((s) => shipClient.get(s))]);
await attribution("clearing agent", U.clearing_agent, "agent", agentShips, agentOrgs,
  (p) => p.role !== "client" || agentOrgs.has(p.organization_id));

// ---- B. database functions ----
const CLIENT_FNS = ["client_invoices", "client_invoice_activity", "client_invoice_lines", "client_receipt", "client_shipment_alerts", "client_timeline", "client_transport"];
const DRIVER_FNS = ["driver_jobs", "driver_job_events"];
const returnsRows = (x) => !x.error && (Array.isArray(x.data) ? x.data.length > 0 : x.data != null);
const anonOpen = [], extra = { client: [], driver: [], agent: [] };
for (const r of RPCS) {
  const a = await anon.rpc(r.name, r.args);
  // includes rls_auto_enable, a platform helper on hosted projects (execute revoked in 0026)
  if (a.error?.code !== "42501") anonOpen.push(`${r.name} (${a.error?.code ?? "ok"})`);
  for (const [k, who, mine] of [["client", U.client, CLIENT_FNS], ["driver", U.driver, DRIVER_FNS], ["agent", U.clearing_agent, []]]) {
    if (mine.includes(r.name)) continue;
    if (returnsRows(await who.api.rpc(r.name, r.args))) extra[k].push(r.name);
  }
}
check(`signed-out users can call none of the ${RPCS.length} database functions`, anonOpen.length === 0, anonOpen.join(", "));
for (const k of Object.keys(extra)) check(`${k}: no function outside its own returns data`, extra[k].length === 0, extra[k].join(", "));

// ---- C. server actions ----
// Needs the action ids of the build under test. Next salts them per build, so they are known only for
// a local build (next start); against a deployed site (staging) this section is skipped: it runs on dev.
const localBuild = /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(APP + "/");
if (!localBuild) console.log("SKIP  server-action guards: action ids are salted per build; run against a local build (covered on dev)");
if (localBuild) {
// Allowed roles, read from each action's guard in lib/actions (the code under test declares them;
// what is checked here is that the running server enforces them before doing any work).
const STAFF = ["admin", "ops_manager", "doc_officer", "clearing_agent", "transport_coord", "driver", "finance"];
const guards = {};
for (const f of fs.readdirSync("lib/actions")) {
  const src = fs.readFileSync(`lib/actions/${f}`, "utf8");
  const consts = Object.fromEntries([...src.matchAll(/const (\w+) = \[([^\]]*)\] as const/g)].map((m) => [m[1], [...m[2].matchAll(/"(\w+)"/g)].map((x) => x[1])]));
  if (src.includes("FINANCE_READERS")) consts.FINANCE_READERS = ["finance", "admin", "ops_manager"];
  for (const m of src.matchAll(/export async function (\w+)[\s\S]*?\n\}/g)) {
    const g = m[0].match(/await (require\w+)\(([^)]*)\)/);
    if (!g) { guards[m[1]] = null; continue; }
    const roles = g[2].startsWith("...") ? consts[g[2].slice(3)] : [...g[2].matchAll(/"(\w+)"/g)].map((x) => x[1]);
    guards[m[1]] = { fn: g[1], roles: g[1] === "requireDriver" ? ["driver"] : roles };
  }
}
const PUBLIC_ACTIONS = ["signIn", "signOut", "requestPasswordReset", "updatePassword"];
const unguarded = Object.entries(guards).filter(([n, g]) => !g && !PUBLIC_ACTIONS.includes(n)).map(([n]) => n);
check("every server action outside sign-in has a role guard", unguarded.length === 0, unguarded.join(", "));
// spot-check the most sensitive guards against the agreed rules
const same = (n, roles) => JSON.stringify([...(guards[n]?.roles ?? [])].sort()) === JSON.stringify([...roles].sort());
check("guards: payment verification is finance only; credit approval finance/admin; closing and invites admin/ops manager",
  same("reviewPayment", ["finance"]) && same("approveCredit", ["finance", "admin"]) && same("closeShipment", ["admin", "ops_manager"])
  && same("reopenShipment", ["admin", "ops_manager"]) && same("inviteUser", ["admin", "ops_manager"]) && same("setUserActive", ["admin", "ops_manager"]));

const manifest = JSON.parse(fs.readFileSync(".next/server/server-reference-manifest.json", "utf8")).node;
const pageOf = (name) => {
  const w = Object.keys(Object.values(manifest).find((v) => v.exportedName === name).workers)[0];
  return w.replace(/^app/, "").replace(/\/page$/, "").replace(/\[id\]/g, "00000000-0000-0000-0000-000000000000")
    .replace(/\[reference\]/g, "NGB-2026-00001").replace(/\[number\]/g, "INV-2026-00001") || "/";
};
const ran = [];
let tried = 0;
for (const [name, g] of Object.entries(guards)) {
  if (!g || g.fn === "requireUser") continue;
  const page = pageOf(name);
  for (const role of [...STAFF, "client", "anon"]) {
    if (g.roles.includes(role)) continue;
    const r = await action(role === "anon" ? null : U[role], name, [], page);
    tried++;
    // refused = redirected (by the proxy, or by the guard inside the action) and no result returned
    if (!r.redirect || (r.value && typeof r.value === "object" && r.value.ok)) ran.push(`${name} as ${role} (${r.status})`);
  }
}
check(`server actions: all ${tried} calls by roles the guard excludes were redirected before any work`, ran.length === 0, ran.slice(0, 8).join("; "));
// requireUser actions: signed-out users are sent to sign in
const userOnly = Object.entries(guards).filter(([, g]) => g?.fn === "requireUser").map(([n]) => n);
const anonRan = [];
for (const n of userOnly) { const r = await action(null, n, [], pageOf(n)); if (!r.redirect) anonRan.push(n); }
check(`signed-out users cannot run any of the ${userOnly.length} signed-in actions`, anonRan.length === 0, anonRan.join(", "));
// an action sent to a page it does not belong to runs nothing
const foreign = await fetch(APP + "/portal", { method: "POST", redirect: "manual", body: await encodeReply([]),
  headers: { cookie: U.client.cookie, "Next-Action": actionId("runSlaCheck"), Accept: "text/x-component", "Content-Type": "text/plain;charset=UTF-8" } });
check("a staff action sent to a client page is not executed", !(foreign.headers.get("content-type") ?? "").includes("text/x-component"));
}

// ---- D. guessing another client's identifiers (Akagera user against Kivu Hardware) ----
const kShip = ships.find((s) => s.client_id === K);
// every dev invoice is Akagera's, so for invoices the Kivu Hardware user does the guessing
const aInv = invs.find((i) => i.client_id === A && i.invoice_number);
const { data: aRcpt } = await svc.from("payment_reviews").select("receipt_number, payments!inner(invoices!inner(client_id))")
  .eq("decision", "verified").eq("payments.invoices.client_id", A).limit(1).maybeSingle();
const kDoc = docs.find((d) => shipClient.get(d.shipment_id) === K);
const alineId = await meId(U.client);
const kNote = notes.find((n) => n.recipient_id !== alineId && !n.read_at);       // someone else's notification
if (kShip) {
  const t = await pageText(await get(`/portal/shipments/${kShip.shipment_reference}`, U.client));
  check("another client's shipment reference shows nothing of it", !t.includes(kShip.shipment_reference.slice(-5) + "</") && !t.includes("Kivu"));
  check("…nor through the API", ((await U.client.api.from("shipments").select("id").eq("id", kShip.id)).data ?? []).length === 0);
  check("…nor its timeline", ((await U.client.api.rpc("client_timeline", { p_shipment_id: kShip.id })).data ?? []).length === 0);
}
if (aInv) {
  check("another client's invoice number returns nothing", ((await jean.api.rpc("client_invoices", { p_invoice_number: aInv.invoice_number })).data ?? []).length === 0
    && ((await jean.api.rpc("client_invoice_lines", { p_invoice_number: aInv.invoice_number })).data ?? []).length === 0);
  const t = await pageText(await get(`/portal/invoices/${aInv.invoice_number}`, jean));
  check("…and its invoice page shows none of it", !t.includes("Akagera") && !t.includes("Balance to pay") && !t.includes("How to pay"));
}
if (aRcpt) check("another client's receipt number returns nothing", ((await jean.api.rpc("client_receipt", { p_receipt_number: aRcpt.receipt_number })).data ?? []).length === 0);
if (kDoc) {
  const r = await get(`/documents/${kDoc.id}`, U.client);
  check("another client's document id → 404 (same as a missing one)", r.status === 404);
  const s = await U.client.api.storage.from("shipment-documents").createSignedUrl(kDoc.storage_path, 60);
  check("…and its storage path cannot be signed", !!s.error || !s.data?.signedUrl);
  const dl = await U.client.api.storage.from("shipment-documents").download(kDoc.storage_path);
  check("…nor downloaded", !!dl.error);
}
if (kNote) {
  const { data: before } = await svc.from("notifications").select("read_at").eq("id", kNote.id).single();
  await action(U.client, "openNotification", [kNote.id], "/portal/notifications");
  const { data: n } = await svc.from("notifications").select("read_at").eq("id", kNote.id).single();
  check("opening another user's notification does not mark it read", n.read_at === before.read_at);
}
// staging's seed has no invoices yet: there the finance guesses are reported as skipped instead
const financeOptional = process.env.LIVE_READ_ONLY === "1";
if (financeOptional && !(aInv && aRcpt)) console.log("SKIP  invoice/receipt guessing: no issued invoices in this project");
check("guessing tests had another client's data to aim at", !!(kShip && kDoc && kNote && (financeOptional || (aInv && aRcpt))), JSON.stringify({ ship: !!kShip, inv: !!aInv, rcpt: !!aRcpt, doc: !!kDoc, note: !!kNote }));

// ---- E. Content-Security-Policy: a fresh nonce on every page, carried by every script we send ----
{
  const pages = [["/", null], ["/login", null], ["/reset-password", null], ["/no-such-page", null], ["/portal", U.client],
    ["/portal/invoices", U.client], ["/admin", U.ops_manager], ["/admin/shipments", U.ops_manager], ["/admin/finance", U.finance], ["/driver", U.driver]];
  const nonces = new Set(), gaps = [];
  let policyOk = true;
  for (const [path, who] of pages) {
    const r = await get(path, who);
    const csp = r.headers.get("content-security-policy") ?? "";
    const n = (csp.match(/'nonce-([^']+)'/) ?? [])[1];
    nonces.add(n);
    policyOk &&= /script-src 'self' 'nonce-[^']+' 'strict-dynamic'(;|$)/.test(csp) && !csp.includes("unsafe-eval") && csp.includes("object-src 'none'")
      && csp.includes("frame-ancestors 'none'") && /connect-src 'self' https:\/\/[a-z0-9]+\.supabase\.co(;|$)/.test(csp);
    const exec = [...(await r.text()).matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]).filter((a) => !/type="application\/(ld\+)?json"/.test(a));
    const miss = exec.filter((a) => !n || !a.includes(`nonce="${n}"`)).length;
    if (miss) gaps.push(`${path} (${miss} of ${exec.length})`);
  }
  check("CSP on every page: nonce + strict-dynamic, no eval, no plugins, no framing, connects only to itself and Supabase", policyOk);
  check(`every executable script on ${pages.length} pages carries that request's nonce`, gaps.length === 0, gaps.join(", "));
  check("a different nonce on every request", nonces.size === pages.length && !nonces.has(undefined));
}

finish();
