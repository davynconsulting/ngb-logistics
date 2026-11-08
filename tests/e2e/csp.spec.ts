import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, signIn } from "./helpers";

// Sprint 5: the nonce-based Content-Security-Policy must not block any of the app's own scripts or
// styles. Every violation the browser reports is collected; pages must also become interactive
// (a blocked script would leave them as dead HTML).

async function watchCsp(page: Page) {
  const violations: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __csp: string[] }).__csp ??= [];
      (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return async () => [...violations, ...(await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []))];
}

test("pages send a nonce CSP and nothing of ours is blocked (signed out)", async ({ page }) => {
  const violations = await watchCsp(page);
  const res = await page.goto("/login");
  const csp = res?.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).not.toContain("unsafe-eval");
  // the login form is a client component: typing works only if its scripts ran
  await page.getByLabel("Email", { exact: true }).fill("nobody@example.com");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("nobody@example.com");
  await page.goto("/");
  expect(await violations()).toEqual([]);
});

test("no CSP violations across the portal and the admin console", async ({ page }) => {
  test.skip(!PASSWORD, "Set E2E_PASSWORD (the seeded test users' password)");
  const violations = await watchCsp(page);
  await signIn(page, "aline@akagera.example");
  for (const path of ["/portal", "/portal/shipments", "/portal/invoices", "/portal/notifications", "/portal/settings"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
  }
  await page.goto("/auth/signout");
  await signIn(page, "ops.manager@ngb.example");
  for (const path of ["/admin", "/admin/shipments", "/admin/exceptions", "/admin/finance", "/admin/reports", "/admin/notifications"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
  }
  // client-side navigation needs the app's scripts: follow a nav link without a full reload
  await page.getByRole("link", { name: "Shipments" }).first().click();
  await expect(page).toHaveURL(/\/admin\/shipments/);
  expect(await violations()).toEqual([]);
});
