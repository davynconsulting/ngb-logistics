import { expect, test } from "@playwright/test";

test("landing page loads with a sign-in link and no horizontal scroll", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/NGB LOGISTICS/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
