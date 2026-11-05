import { expect, test } from "@playwright/test";
import { PASSWORD, expectNoHorizontalScroll, signIn, submitLogin } from "./helpers";

test.skip(!PASSWORD, "Set E2E_PASSWORD (the seeded test users' password)");

test("wrong password shows a generic error", async ({ page }) => {
  await submitLogin(page, "admin@ngb.example", "not-the-password-123");
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("client lands on the portal and cannot open the admin area", async ({ page }) => {
  await signIn(page, "aline@akagera.example");
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.goto("/admin/shipments");
  await expect(page).toHaveURL(/\/portal$/);
});

test("staff lands on the admin overview and can sign out", async ({ page }) => {
  await signIn(page, "ops.manager@ngb.example");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Operations overview" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
});
