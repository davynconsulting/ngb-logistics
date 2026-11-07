// Runs every live check in ONE process (so test users sign in only once): npm run test:live
// Needs a production build served locally:  npm run build && npx next start -p 3123
globalThis.__LIVE_RUNNER__ = true;
const { APP, totals } = await import("./_shared.mjs");

try {
  const r = await fetch(APP, { redirect: "manual" });
  if (r.status >= 500) throw new Error(String(r.status));
} catch {
  console.error(`No app at ${APP}. Start one first: npm run build && npx next start -p 3123`);
  process.exit(1);
}

const suites = ["auth-routing.mjs", "admin-flows.mjs", "documents.mjs", "milestones.mjs", "operations.mjs", "notifications.mjs", "portal.mjs", "driver.mjs", "finance.mjs", "closure.mjs", "reports.mjs", "pwa.mjs"];
const crashed = [];
for (const s of suites) {
  try {
    await import(new URL(s, import.meta.url).href);
  } catch (e) {
    crashed.push(s);
    console.log(`CRASH ${s}: ${e instanceof Error ? e.message : e}`);
  }
  console.log();
}
console.log(`Live checks: ${totals.pass} passed, ${totals.fail} failed${crashed.length ? `, crashed: ${crashed.join(", ")}` : ""}`);
process.exit(totals.fail || crashed.length ? 1 : 0);
