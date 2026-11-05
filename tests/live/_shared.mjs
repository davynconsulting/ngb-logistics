// Shared helpers for the live checks (tests/live). These run against the hosted
// DEV Supabase project and a local production server, as real seeded users.
// They never print secrets and refuse to run against any other project.
import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire(import.meta.url);
export const { createClient } = require("@supabase/supabase-js");
export const { createServerClient } = require("@supabase/ssr");
export const { encodeReply } = require("next/dist/compiled/react-server-dom-turbopack/client.node.js");

export const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const PW = process.env.SEED_USER_PASSWORD;
export const APP = process.env.LIVE_APP_URL ?? "http://localhost:3123";
export const BUCKET = "shipment-documents";
if (!URL_?.includes("idyydcuihxkyitylkugo")) throw new Error("Live checks only run against the dev project");

/** Every request gives up after 60 s, so a stalled connection fails a check instead of freezing the run. */
const timedFetch = (url, opts = {}) => fetch(url, { ...opts, signal: opts.signal ?? AbortSignal.timeout(60_000) });
const global = { fetch: timedFetch };

export const svc = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false }, global });

let pass = 0, fail = 0;
export const totals = { pass: 0, fail: 0 };
export const check = (name, ok, extra = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" && extra !== undefined ? `  (${extra})` : ""}`);
};
/** End of a suite. Standalone: exit with its result. Under run.mjs: add to the totals. */
export const finish = () => {
  console.log(`${pass} passed, ${fail} failed`);
  totals.pass += pass; totals.fail += fail; pass = 0; fail = 0;
  if (!globalThis.__LIVE_RUNNER__) process.exit(totals.fail ? 1 : 0);
};

/**
 * Sign in as a seeded user: returns the app session cookie and a direct API client.
 * Each user signs in ONCE per process (Supabase limits sign-ins per IP, ~30 per 5 min).
 */
const sessions = new Map();
export async function login(email) {
  if (!sessions.has(email)) sessions.set(email, signInOnce(email));
  return sessions.get(email);
}
async function signInOnce(email) {
  const jar = new Map();
  const ssr = createServerClient(URL_, ANON, { global, cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (cs) => cs.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))) } });
  const { error } = await ssr.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  await new Promise((r) => setTimeout(r, 50));
  const { data: { session } } = await ssr.auth.getSession();
  // Same session for direct API calls (no second sign-in; no auto refresh so the token isn't rotated)
  const api = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false }, global });
  await api.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  return { cookie: [...jar].map(([n, v]) => `${n}=${v}`).join("; "), api };
}

export const get = (path, who) => timedFetch(APP + path, { headers: who?.cookie ? { cookie: who.cookie } : {}, redirect: "manual" });
export const pageText = async (r) => (await r.text()).replace(/<!-- -->/g, "");

const manifest = () => JSON.parse(fs.readFileSync(".next/server/server-reference-manifest.json", "utf8")).node;
let ids;
export const actionId = (name) => {
  ids ??= Object.fromEntries(Object.entries(manifest()).map(([id, v]) => [v.exportedName, id]));
  if (!ids[name]) throw new Error(`server action ${name} not found in the build`);
  return ids[name];
};

async function post(who, name, body, page, extraHeaders = {}) {
  const r = await timedFetch(APP + page, { method: "POST", redirect: "manual", body,
    headers: { ...(who?.cookie ? { cookie: who.cookie } : {}), "Next-Action": actionId(name), Accept: "text/x-component", ...extraHeaders } });
  const text = await r.text();
  const m = text.match(/^1:(.*)$/m);
  let value; try { value = m ? JSON.parse(m[1]) : undefined; } catch { value = m?.[1]; }
  return { status: r.status, value, headers: r.headers, redirect: r.headers.get("x-action-redirect") ?? r.headers.get("location") };
}
/** Call a server action with plain arguments, exactly as the browser does. */
export const action = async (who, name, args, page) => post(who, name, await encodeReply(args), page,
  { "Content-Type": "text/plain;charset=UTF-8" });
/** Call a form action (…, prevState, FormData) exactly as the browser does. */
export async function formAction(who, name, args, fields, page) {
  const form = new FormData();
  // an array value appends the field several times (checkbox groups)
  for (const [k, v] of Object.entries(fields)) for (const x of [].concat(v)) form.append(k, x);
  return post(who, name, await encodeReply([...args, form]), page);
}

/** ISO 6346 container number with a valid check digit, e.g. cn(123) → NGBU0001235 */
const L = { A:10,B:12,C:13,D:14,E:15,F:16,G:17,H:18,I:19,J:20,K:21,L:23,M:24,N:25,O:26,P:27,Q:28,R:29,S:30,T:31,U:32,V:34,W:35,X:36,Y:37,Z:38 };
export const checkDigit = (s) => { let t = 0; for (let i = 0; i < 10; i++) t += (L[s[i]] ?? +s[i]) * 2 ** i; return (t % 11) % 10; };
export const cn = (n) => { const b = "NGBU" + String(n).padStart(6, "0"); return b + checkDigit(b); };
