import { expect, test } from "@playwright/test";
import { PASSWORD, expectNoHorizontalScroll, signIn } from "./helpers";

test.skip(!PASSWORD, "Set E2E_PASSWORD (the seeded test users' password)");

// Drivers work from a phone: the driver pages must fit 360 px without sideways scrolling.
test.use({ viewport: { width: 360, height: 760 } });

test("driver on a 360 px phone: jobs, job page, kept out of admin", async ({ page }) => {
  await signIn(page, "driver@ngb.example");
  await expect(page).toHaveURL(/\/driver$/);
  await expect(page.getByRole("heading", { name: "My jobs" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  const first = page.locator("main a[href^='/driver/jobs/']").first();
  if (await first.count()) {
    await first.click();
    await expect(page.getByRole("heading", { name: "Delivery" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Report a problem" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  }

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/driver$/);
});
