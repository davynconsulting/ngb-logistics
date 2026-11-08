// Lighthouse audit (Sprint 5), run in CI after a production build: node tests/lighthouse/run.mjs
// Starts `next start`, signs in through the real login form in Playwright's Chromium, then audits public
// and signed-in pages with Lighthouse's mobile defaults (slow 4G, mid-range phone).
//   Must pass: accessibility >= 0.95, best practices >= 0.90. Performance is reported, not enforced:
//   shared CI machines make it noisy. Reports go to lighthouse-report/ (uploaded by CI).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import lighthouse from "lighthouse";

try { process.loadEnvFile(".env.local"); } catch { /* CI */ }
const PASSWORD = process.env.E2E_PASSWORD ?? process.env.SEED_USER_PASSWORD;
if (!PASSWORD) { console.error("Set E2E_PASSWORD"); process.exit(1); }
const PORT = 3100, BASE = `http://localhost:${PORT}`, DEBUG = 9223;
const MIN = { accessibility: 0.95, "best-practices": 0.9 };
const OUT = "lighthouse-report";

const server = spawn("npx", ["next", "start", "-p", String(PORT)], { stdio: "ignore", detached: true });
const stop = () => { try { process.kill(-server.pid); } catch { /* gone */ } };
process.on("exit", stop);
for (let i = 0; ; i++) {
  try { await fetch(BASE); break; } catch { if (i > 120) throw new Error("server did not start"); await new Promise((r) => setTimeout(r, 500)); }
}

// One persistent Chromium: Playwright signs in, Lighthouse audits in the same profile (keeps the cookie)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "lh-"));
const ctx = await chromium.launchPersistentContext(profile, { headless: true, args: [`--remote-debugging-port=${DEBUG}`] });
const page = ctx.pages()[0] ?? (await ctx.newPage());
async function signIn(email) {
  await page.goto(`${BASE}/auth/signout`);
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
}

const runs = [
  [null, ["/", "/login"]],
  ["aline@akagera.example", ["/portal", "/portal/shipments", "/portal/invoices"]],
  ["ops.manager@ngb.example", ["/admin", "/admin/shipments"]],
  ["driver@ngb.example", ["/driver"]],
];
fs.mkdirSync(OUT, { recursive: true });
const rows = [], failures = [];
for (const [who, paths] of runs) {
  if (who) await signIn(who);
  for (const p of paths) {
    const r = await lighthouse(BASE + p, {
      port: DEBUG, output: "html", logLevel: "error", disableStorageReset: true,
      onlyCategories: ["performance", "accessibility", "best-practices"],
    });
    const c = r.lhr.categories;
    const score = (k) => Math.round((c[k]?.score ?? 0) * 100);
    rows.push({ page: p, user: who ?? "signed out", performance: score("performance"), accessibility: score("accessibility"), "best-practices": score("best-practices"),
      lcp: r.lhr.audits["largest-contentful-paint"]?.displayValue, cls: r.lhr.audits["cumulative-layout-shift"]?.displayValue });
    for (const [k, min] of Object.entries(MIN)) {
      if ((c[k]?.score ?? 0) < min) {
        const failed = Object.values(r.lhr.audits).filter((a) => a.score !== null && a.score < 1 && c[k].auditRefs.some((ref) => ref.id === a.id && ref.weight > 0)).map((a) => a.id);
        failures.push(`${p}: ${k} ${score(k)} < ${min * 100} (${failed.join(", ")})`);
      }
    }
    fs.writeFileSync(path.join(OUT, `${p.replace(/\//g, "_") || "_"}.html`), r.report);
  }
}
await ctx.close();
stop();

const table = ["| Page | User | Performance | Accessibility | Best practices | LCP | CLS |", "|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.page} | ${r.user} | ${r.performance} | ${r.accessibility} | ${r["best-practices"]} | ${r.lcp ?? ""} | ${r.cls ?? ""} |`)].join("\n");
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Lighthouse (mobile)\n\n${table}\n`);
if (failures.length) { console.log("\nBelow the minimum:\n" + failures.map((f) => "  " + f).join("\n")); process.exit(1); }
console.log("\nAll pages meet the minimum scores.");
