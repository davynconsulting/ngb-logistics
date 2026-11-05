// Fails if a server-only secret could reach a browser: scans everything the
// production build ships to clients (.next/static, prerendered pages, public/).
//
//   npm run build && npm run check:secrets
//
// 1. Patterns (also in CI, where no secrets exist): Supabase JWTs with a role
//    other than "anon", "sb_secret_" keys, PEM private keys.
// 2. Exact values (locally): every non-NEXT_PUBLIC_ variable from .env.local.
// Prints variable NAMES and file paths only, never values.
import fs from "node:fs";
import path from "node:path";

const ROOTS = [".next/static", ".next/server/app", "public"];
// .next/server/app holds server code too; only the prerendered output is sent to browsers
const SHIPPED_IN_SERVER_APP = /\.(html|rsc|body|meta|prefetch\.rsc|segment\.rsc)$/;

if (!fs.existsSync(".next/static")) {
  console.error("No build found. Run `npm run build` first.");
  process.exit(2);
}

function* files(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (!p.startsWith(".next/server/app") || SHIPPED_IN_SERVER_APP.test(p)) yield p;
  }
}

// exact values of server-only variables named in .env.local (if present)
const names = fs.existsSync(".env.local")
  ? fs.readFileSync(".env.local", "utf8").split("\n").map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=/)?.[1]).filter(Boolean)
  : [];
const secrets = names
  .filter((n) => !n.startsWith("NEXT_PUBLIC_"))
  .map((n) => [n, process.env[n]])
  .filter(([, v]) => typeof v === "string" && v.length >= 12);

const jwtRole = (token) => {
  try { return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).role; } catch { return undefined; }
};

const problems = [];
let scanned = 0;
for (const root of ROOTS) {
  for (const file of files(root)) {
    const buf = fs.readFileSync(file);
    if (buf.length > 20 * 1024 * 1024) continue;
    const text = buf.toString("latin1");
    scanned++;
    for (const [name, value] of secrets) if (text.includes(value)) problems.push(`${file}: value of ${name}`);
    for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
      const role = jwtRole(m[0]);
      if (role && role !== "anon") problems.push(`${file}: a JWT with role "${role}"`);
    }
    if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(text)) problems.push(`${file}: an sb_secret_ key`);
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) problems.push(`${file}: a PEM private key`);
  }
}

console.log(`Scanned ${scanned} shipped files; checked ${secrets.length} server-only values (${secrets.map(([n]) => n).join(", ") || "none: no .env.local"}) and secret patterns.`);
if (problems.length) {
  console.error(`SECRETS FOUND in client-visible files:\n  ${[...new Set(problems)].join("\n  ")}`);
  process.exit(1);
}
console.log("No server-only secret found in what browsers can download.");
