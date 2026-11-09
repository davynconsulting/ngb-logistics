/**
 * Staging environment set-up (Sprint 5, Task 5). One step at a time; each step
 * that changes something on Supabase is run only after the owner approves it.
 *
 *   node scripts/staging.mjs create     create the free project ngb-logistics-staging (eu-west-1, same region as dev)
 *                                       and write its keys to .env.staging.local
 *   node scripts/staging.mjs keys       add notification keys, seed password, SITE_URL to .env.staging.local
 *   node scripts/staging.mjs migrate    dry run of the migrations (add --apply to push them)
 *   node scripts/staging.mjs sender     deploy notify-sender, set its secrets, store its URL/secret in Vault
 *   node scripts/staging.mjs status     what is set up, by name only
 *
 * Secrets go only into .env.staging.local (gitignored: .env*) and to Supabase; nothing
 * secret is printed; secrets reach the CLI through temporary owner-only files deleted straight
 * after (the database password, needed once, is the one flag). Never point this at production.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FILE = ".env.staging.local";
const NAME = "ngb-logistics-staging";
const ORG = "ylpakpaqmolvluekapcz";        // same organization as dev
const REGION = "eu-west-1";                 // same region as dev
const DEV_REF = "idyydcuihxkyitylkugo";

const readEnv = () => Object.fromEntries((fs.existsSync(FILE) ? fs.readFileSync(FILE, "utf8") : "").split("\n")
  .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
function writeEnv(add, heading) {
  const cur = fs.existsSync(FILE) ? fs.readFileSync(FILE, "utf8") : "# Staging environment (Supabase ngb-logistics-staging). Secrets: never commit, never print.\n";
  const env = readEnv();
  const lines = Object.entries(add).filter(([k]) => !env[k]).map(([k, v]) => `${k}=${v}`);
  if (lines.length) fs.writeFileSync(FILE, `${cur.replace(/\n*$/, "\n")}\n# ${heading}\n${lines.join("\n")}\n`, { mode: 0o600 });
  fs.chmodSync(FILE, 0o600);
  console.log(lines.length ? `Added to ${FILE}: ${lines.map((l) => l.split("=")[0]).join(", ")}` : `${FILE}: nothing to add`);
}
const secret = (n = 32) => randomBytes(n).toString("base64url");

function cli(args, { env = {}, json = false, quiet = false } = {}) {
  const r = spawnSync("npx", ["supabase", ...args, ...(json ? ["--output-format", "json"] : [])], {
    encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) {
    // CLI errors don't contain our secrets (they are never on the command line), but trim anyway
    throw new Error(`supabase ${args[0]} ${args[1] ?? ""} failed: ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ").slice(0, 400)}`);
  }
  if (!quiet && !json) process.stdout.write(r.stdout.split("\n").filter((l) => !/sb_secret_|eyJ/.test(l)).join("\n"));
  if (!json) return r.stdout;
  const starts = [r.stdout.indexOf("{"), r.stdout.indexOf("[")].filter((i) => i >= 0);
  return JSON.parse(r.stdout.slice(Math.min(...starts)));
}

function staging() {
  const env = readEnv();
  const ref = env.STAGING_PROJECT_REF;
  if (!/^[a-z]{20}$/.test(ref ?? "")) throw new Error(`No STAGING_PROJECT_REF in ${FILE}: run "create" first`);
  if (ref === DEV_REF) throw new Error("STAGING_PROJECT_REF is the dev project");
  return { env, ref };
}

/** Run with a temporary owner-only file holding secrets, deleted afterwards. */
function withTempFile(name, content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ngb-staging-"));
  const f = path.join(dir, name);
  fs.writeFileSync(f, content, { mode: 0o600 });
  try { return fn(f); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const step = process.argv[2];
const apply = process.argv.includes("--apply");

if (step === "create") {
  if (readEnv().STAGING_PROJECT_REF) throw new Error(`${FILE} already names a staging project`);
  const existing = cli(["projects", "list"], { json: true });
  if ((existing.projects ?? existing).some((p) => p.name === NAME)) throw new Error(`A project named ${NAME} already exists`);
  const dbPassword = secret(24);
  // projects create takes the password only as a flag (visible to local processes for a moment);
  // later steps never need it: the CLI signs in with a temporary login role, as for dev
  const created = cli(["projects", "create", NAME, "--org-id", ORG, "--region", REGION, "--db-password", dbPassword, "--yes"], { json: true });
  const ref = created.ref ?? created.id ?? created.project?.ref;
  if (!/^[a-z]{20}$/.test(ref ?? "")) throw new Error("Project created but its ref was not in the CLI output; check the dashboard");
  writeEnv({ STAGING_PROJECT_REF: ref, SUPABASE_DB_PASSWORD: dbPassword }, "Project");
  console.log(`Created ${NAME} (${ref}) in ${REGION}. Waiting for it to be ready…`);
  for (let i = 0; i < 60; i++) {
    const list = cli(["projects", "list"], { json: true });
    const p = (list.projects ?? list).find((x) => x.ref === ref || x.id === ref);
    if (p?.status === "ACTIVE_HEALTHY") break;
    spawnSync("sleep", ["10"]);
  }
  const keys = cli(["projects", "api-keys", `--remote=${ref}`, "--reveal"], { json: true });
  const list = keys.keys ?? keys.api_keys ?? keys;
  const pick = (re) => list.find((k) => re.test(k.api_key ?? k.key ?? ""))?.api_key ?? list.find((k) => re.test(k.api_key ?? k.key ?? ""))?.key;
  const publishable = pick(/^sb_publishable_/), sec = pick(/^sb_secret_/);
  if (!publishable || !sec) throw new Error("Could not read the new project's API keys (publishable/secret); create them in the dashboard");
  writeEnv({ NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`, NEXT_PUBLIC_SUPABASE_ANON_KEY: publishable, SUPABASE_SERVICE_ROLE_KEY: sec }, "API");
} else if (step === "keys") {
  const { ref } = staging();
  writeEnv({ SEED_USER_PASSWORD: secret(18), SITE_URL: process.argv[3] ?? "https://ngb-logistics-staging.vercel.app" }, "App");
  const r = spawnSync("node", ["scripts/gen-notify-keys.mts", FILE], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
  console.log(`Keys ready for ${ref}.`);
} else if (step === "migrate") {
  const { ref } = staging();
  cli(["db", "push", `--remote=${ref}`, ...(apply ? ["--yes"] : ["--dry-run"])]);
} else if (step === "sender") {
  const { env, ref } = staging();
  for (const k of ["NOTIFY_SENDER_SECRET", "NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) if (!env[k]) throw new Error(`${k} missing: run "keys" first`);
  cli(["functions", "deploy", "notify-sender", "--use-api", "--no-verify-jwt", `--remote=${ref}`, "--yes"], { quiet: true });
  console.log("notify-sender deployed");
  withTempFile("sender.env", [
    `NOTIFY_SENDER_SECRET=${env.NOTIFY_SENDER_SECRET}`, `VAPID_PUBLIC_KEY=${env.NEXT_PUBLIC_VAPID_PUBLIC_KEY}`,
    `VAPID_PRIVATE_KEY=${env.VAPID_PRIVATE_KEY}`, `VAPID_SUBJECT=${env.VAPID_SUBJECT}`,
    "WHATSAPP_PROVIDER=mock", "WHATSAPP_MOCK_MODE=ok",
  ].join("\n") + "\n", (f) => cli(["secrets", "set", "--env-file", f, `--remote=${ref}`, "--yes"], { quiet: true }));
  console.log("function secrets set: NOTIFY_SENDER_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, WHATSAPP_PROVIDER=mock, WHATSAPP_MOCK_MODE=ok");
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const url = `https://${ref}.supabase.co/functions/v1/notify-sender`;
  const sql = ["notify_sender_url", "notify_sender_secret"].map((name, i) => {
    const value = i === 0 ? url : env.NOTIFY_SENDER_SECRET;
    return `do $$ begin
  if exists (select 1 from vault.secrets where name = ${q(name)}) then
    perform vault.update_secret((select id from vault.secrets where name = ${q(name)}), ${q(value)});
  else
    perform vault.create_secret(${q(value)}, ${q(name)});
  end if;
end $$;`;
  }).join("\n");
  withTempFile("vault.sql", sql, (f) => cli(["db", "query", `--remote=${ref}`, "-f", f, "--yes"], { quiet: true }));
  console.log("Vault: notify_sender_url, notify_sender_secret stored");
} else if (step === "status") {
  const { env, ref } = staging();
  console.log(`Staging project ${ref}`);
  console.log(`${FILE}: ${Object.keys(env).join(", ")}`);
  cli(["migration", "list", `--remote=${ref}`]);
} else {
  console.log("Usage: node scripts/staging.mjs create | keys [site url] | migrate [--apply] | sender | status");
  process.exit(1);
}
