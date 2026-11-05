import { expect, test } from "@playwright/test";
import { PASSWORD, expectNoHorizontalScroll, signIn } from "./helpers";

test.skip(!PASSWORD, "Set E2E_PASSWORD (the seeded test users' password)");

test("finance: invoice list and draft editor with a decimal-exact live preview", async ({ page }) => {
  await signIn(page, "finance@ngb.example");
  await page.goto("/admin/finance");
  await expect(page.getByRole("heading", { name: "Finance" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.getByRole("link", { name: "New invoice" }).click();
  await expect(page.getByRole("heading", { name: "New invoice" })).toBeVisible();
  await page.getByLabel("Line 1", { exact: true }).fill("Port handling (e2e, not saved)");
  await page.getByLabel("Qty", { exact: true }).fill("2");
  await page.getByLabel("Unit price", { exact: true }).fill("150.25");
  await page.getByLabel("Tax %", { exact: true }).fill("18");
  // 2 × 150.25 = 300.50; 18% tax = 54.09; total 354.59 (same rounding as the database)
  await expect(page.getByText("354.59 USD")).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("finance pages are closed to a document officer", async ({ page }) => {
  await signIn(page, "doc.officer@ngb.example");
  await page.goto("/admin/finance");
  await expect(page.getByText("Invoices, payments and balances")).toHaveCount(0);
});
