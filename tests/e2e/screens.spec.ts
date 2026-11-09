import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { PASSWORD, signIn } from "./helpers";

// Sprint 5 / AC-17: every screen, for every kind of user, on a 360 px phone (mobile project) and on a
// desktop (desktop project): no horizontal scrolling, and no WCAG 2.2 A/AA problems that axe can find.
// Problems are collected across the whole tour and printed together, so one CI run lists them all.

test.skip(!PASSWORD, "Set E2E_PASSWORD (the seeded test users' password)");
// a tour visits up to 17 screens and runs axe on each: well over the default 30 s
test.describe.configure({ timeout: 180_000 });

type Problem = { page: string; kind: string; detail: string };

async function useViewport(page: Page, info: TestInfo) {
  if (info.project.name === "mobile") await page.setViewportSize({ width: 360, height: 760 });
}

async function check(page: Page, path: string, problems: Problem[], label = path) {
  const res = await page.goto(path);
  expect(res?.status(), `${label} answered`).toBeLessThan(500);
  await expect(page.locator("main").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) problems.push({ page: label, kind: "horizontal-scroll", detail: `${overflow}px wider than the screen` });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  for (const v of axe.violations) {
    const where = v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ");
    problems.push({ page: label, kind: `${v.id} (${v.impact})`, detail: `${v.help}: ${where}${v.nodes.length > 3 ? ` (+${v.nodes.length - 3} more)` : ""}` });
  }
}

/** First link on the current page whose href starts with prefix (skipping /new). */
async function firstLink(page: Page, prefix: string): Promise<string | null> {
  const hrefs = await page.locator(`a[href^='${prefix}']:visible`).evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  return hrefs.find((h) => h !== prefix && !h.endsWith("/new") && !h.includes("?")) ?? null;
}

function report(problems: Problem[], info: TestInfo) {
  if (problems.length) {
    console.log(`\n[${info.project.name}] ${problems.length} problem(s):\n` + problems.map((p) => `  ${p.page} · ${p.kind} · ${p.detail}`).join("\n"));
  }
  expect(problems, "screen problems (listed above)").toEqual([]);
}

test("signed-out screens", async ({ page }, info) => {
  await useViewport(page, info);
  const problems: Problem[] = [];
  for (const p of ["/", "/login", "/reset-password", "/update-password", "/no-such-page"]) await check(page, p, problems);
  report(problems, info);
});

test("client portal screens", async ({ page }, info) => {
  await useViewport(page, info);
  const problems: Problem[] = [];
  await signIn(page, "aline@akagera.example");
  for (const p of ["/portal", "/portal/shipments", "/portal/invoices", "/portal/notifications", "/portal/settings"]) await check(page, p, problems);
  await page.goto("/portal/shipments");
  const ship = await firstLink(page, "/portal/shipments/");
  if (ship) await check(page, ship, problems, "/portal/shipments/[reference]");
  await page.goto("/portal/invoices");
  const inv = await firstLink(page, "/portal/invoices/");
  if (inv) {
    await check(page, inv, problems, "/portal/invoices/[number]");
    const rcpt = await firstLink(page, "/portal/receipts/");
    if (rcpt) await check(page, rcpt, problems, "/portal/receipts/[number]");
  }
  report(problems, info);
});

test("admin console screens", async ({ page }, info) => {
  await useViewport(page, info);
  const problems: Problem[] = [];
  await signIn(page, "admin@ngb.example");
  for (const p of ["/admin", "/admin/shipments", "/admin/shipments/new", "/admin/exceptions", "/admin/clients", "/admin/clients/new",
    "/admin/finance", "/admin/finance/invoices/new", "/admin/reports", "/admin/notifications", "/admin/users", "/admin/users/new", "/admin/account"])
    await check(page, p, problems);
  for (const [list, prefix, label] of [["/admin/shipments", "/admin/shipments/", "/admin/shipments/[id]"], ["/admin/clients", "/admin/clients/", "/admin/clients/[id]"],
    ["/admin/finance", "/admin/finance/invoices/", "/admin/finance/invoices/[id]"]] as const) {
    await page.goto(list);
    const href = await firstLink(page, prefix);
    if (href) await check(page, href, problems, label);
    if (href && label === "/admin/finance/invoices/[id]") {
      const rcpt = await firstLink(page, "/admin/finance/receipts/");
      if (rcpt) await check(page, rcpt, problems, "/admin/finance/receipts/[paymentId]");
    }
  }
  report(problems, info);
});

test("driver screens", async ({ page }, info) => {
  await useViewport(page, info);
  const problems: Problem[] = [];
  await signIn(page, "driver@ngb.example");
  for (const p of ["/driver", "/driver/settings"]) await check(page, p, problems);
  await page.goto("/driver");
  const job = await firstLink(page, "/driver/jobs/");
  if (job) await check(page, job, problems, "/driver/jobs/[assignmentId]");
  report(problems, info);
});

test("dark mode: colour contrast on the main screens", async ({ page }, info) => {
  await useViewport(page, info);
  await page.emulateMedia({ colorScheme: "dark" });
  const problems: Problem[] = [];
  const contrast = async (path: string) => {
    await page.goto(path);
    await expect(page.locator("main").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    const axe = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
    for (const v of axe.violations) problems.push({ page: `${path} (dark)`, kind: v.id, detail: v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ") });
  };
  await contrast("/login");
  await signIn(page, "aline@akagera.example");
  for (const p of ["/portal", "/portal/shipments", "/portal/invoices"]) await contrast(p);
  await page.goto("/auth/signout");
  await signIn(page, "admin@ngb.example");
  for (const p of ["/admin", "/admin/shipments", "/admin/finance", "/admin/reports"]) await contrast(p);
  report(problems, info);
});
