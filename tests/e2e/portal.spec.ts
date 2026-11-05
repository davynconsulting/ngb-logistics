import { expect, test } from "@playwright/test";
import { PASSWORD, expectNoHorizontalScroll, signIn } from "./helpers";

test.skip(!PASSWORD, "Set E2E_PASSWORD (the seeded test users' password)");

// AC-17: the client portal works on a 360 px phone without horizontal scrolling.
test.use({ viewport: { width: 360, height: 760 } });

test("client portal on a 360 px phone: overview, shipment, inbox, settings (AC-17)", async ({ page }) => {
  await signIn(page, "aline@akagera.example");
  await page.goto("/portal");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // bottom navigation on phones
  const bottom = page.getByRole("navigation", { name: "Portal" }).last();
  await expect(bottom.getByRole("link", { name: "Shipments" })).toBeVisible();

  await bottom.getByRole("link", { name: "Shipments" }).click();
  await expect(page).toHaveURL(/\/portal\/shipments/);
  await expectNoHorizontalScroll(page);

  // Next keeps the previous page mounted but hidden (React Activity), so only look at visible links
  const first = page.locator("main li a[href^='/portal/shipments/']:visible").first();
  if (await first.count()) {
    await first.click();
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  }

  await bottom.getByRole("link", { name: "Invoices" }).click();
  await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await bottom.getByRole("link", { name: "Notifications" }).click();
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await bottom.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByText("Notifications on this device")).toBeVisible();
  await expect(page.getByText("Send me WhatsApp messages")).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("another client's shipment reference shows 'not found' (AC-05)", async ({ page }) => {
  await signIn(page, "jean@kivuhardware.example");
  await page.goto("/portal/shipments/NGB-1999-99999");
  await expect(page.getByText(/could not be found/i)).toBeVisible();
});
