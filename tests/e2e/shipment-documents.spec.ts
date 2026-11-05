import { expect, test } from "@playwright/test";
import { PASSWORD, containerNumber, expectNoHorizontalScroll, samplePdf, signIn } from "./helpers";

test.skip(!PASSWORD, "Set E2E_PASSWORD (the seeded test users' password)");
test.describe.configure({ mode: "serial" });

// One fictional shipment per run and per browser project
const stamp = Date.now();
let shipmentUrl = "";

test("doc officer registers a shipment with two containers (AC-01, AC-02)", async ({ page }, info) => {
  const bl = `E2EBL${info.project.name.slice(0, 1).toUpperCase()}${String(stamp).slice(-7)}`;
  await signIn(page, "doc.officer@ngb.example");
  await page.goto("/admin/shipments/new");
  await expectNoHorizontalScroll(page);

  await page.getByLabel("Client", { exact: true }).selectOption({ label: "Akagera Trading Ltd (TEST) (AKAGERA)" });
  await page.getByLabel("Bill of lading number", { exact: true }).fill(bl);
  await page.getByLabel("Port of discharge", { exact: true }).selectOption({ label: "Dar es Salaam (TZDAR)" });
  await page.getByLabel("Destination city", { exact: true }).fill("Kigali");
  await page.getByLabel("Description", { exact: true }).fill("E2E test cargo (fictional)");

  // Wrong check digit is flagged while typing
  const first = containerNumber(stamp + (info.project.name === "mobile" ? 0 : 500));
  const wrong = first.slice(0, 10) + ((Number(first[10]) + 1) % 10);
  await page.getByLabel("Container 1", { exact: true }).fill(wrong);
  await expect(page.getByText("Check digit doesn't match")).toBeVisible();
  await page.getByLabel("Container 1", { exact: true }).fill(first);
  await expect(page.getByText("Check digit doesn't match")).toBeHidden();

  await page.getByRole("button", { name: "Add container" }).click();
  await page.getByLabel("Container 2", { exact: true }).fill(containerNumber(stamp + (info.project.name === "mobile" ? 1 : 501)));

  await page.getByRole("button", { name: "Register shipment" }).click();
  await expect(page).toHaveURL(/\/admin\/shipments\/[0-9a-f-]{36}\?created=1$/);
  await expect(page.getByText("Shipment registered as draft")).toBeVisible();
  await expect(page.getByText(first, { exact: true }).first()).toBeVisible();
  shipmentUrl = page.url().replace(/\?created=1$/, "");

  // Same BL again is rejected (AC-01)
  await page.goto("/admin/shipments/new");
  await page.getByLabel("Client", { exact: true }).selectOption({ label: "Akagera Trading Ltd (TEST) (AKAGERA)" });
  await page.getByLabel("Bill of lading number", { exact: true }).fill(bl.toLowerCase());
  await page.getByLabel("Port of discharge", { exact: true }).selectOption({ label: "Dar es Salaam (TZDAR)" });
  await page.getByLabel("Destination city", { exact: true }).fill("Kigali");
  await page.getByLabel("Container 1", { exact: true }).fill(containerNumber(stamp + (info.project.name === "mobile" ? 2 : 502)));
  await page.getByRole("button", { name: "Register shipment" }).click();
  await expect(page.getByText("A shipment with this bill of lading already exists")).toBeVisible();
});

test("doc officer uploads, verifies and opens a document (AC-16)", async ({ page }) => {
  test.skip(!shipmentUrl, "needs the shipment from the previous test");
  await signIn(page, "doc.officer@ngb.example");
  await page.goto(shipmentUrl);

  const upload = page.locator("#upload"); // the main upload panel (new-version forms also have a File field)
  await upload.getByLabel("Document type", { exact: true }).selectOption("bill_of_lading");
  await upload.getByLabel("File", { exact: true }).setInputFiles({ name: "bl-e2e.pdf", mimeType: "application/pdf", buffer: samplePdf("BL") });
  await upload.getByRole("button", { name: "Upload document", exact: true }).click();
  await expect(page.getByText("bl-e2e.pdf uploaded.")).toBeVisible();
  await expect(page.getByText("Awaiting review")).toBeVisible();

  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByText("Verified", { exact: true })).toBeVisible();

  // The View link redirects to a short-lived signed URL
  const href = await page.getByRole("link", { name: "View", exact: true }).first().getAttribute("href");
  expect(href).toMatch(/^\/documents\/[0-9a-f-]{36}$/);
  const res = await page.request.get(href!, { maxRedirects: 0 });
  expect(res.status()).toBe(303);
  expect(res.headers()["location"]).toContain("token=");
});

test("another client cannot open the document link", async ({ browser }) => {
  test.skip(!shipmentUrl, "needs the shipment from the first test");
  const staff = await browser.newPage();
  await signIn(staff, "doc.officer@ngb.example");
  await staff.goto(shipmentUrl);
  const href = await staff.getByRole("link", { name: "View", exact: true }).first().getAttribute("href");
  await staff.close();

  const other = await browser.newPage();
  await signIn(other, "jean@kivuhardware.example");
  await expect(other).toHaveURL(/\/portal$/);
  const res = await other.request.get(href!, { maxRedirects: 0 });
  expect(res.status()).toBe(404);
  await other.close();
});

test("doc officer records, then cancels, a milestone (AC-03, AC-04)", async ({ page }) => {
  test.skip(!shipmentUrl, "needs the shipment from the first test");
  await signIn(page, "doc.officer@ngb.example");
  await page.goto(shipmentUrl);
  const form = page.locator("#record");
  await form.getByLabel("Milestone", { exact: true }).selectOption("shipment_confirmed");
  await form.getByLabel("Note for the client (optional)", { exact: true }).fill("Booking confirmed with the carrier (E2E)");
  await form.getByRole("button", { name: "Record milestone" }).click();
  await expect(form.getByText("Milestone recorded.")).toBeVisible();
  await expect(page.getByText("Booking confirmed with the carrier (E2E)")).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.getByRole("button", { name: "Cancel milestone" }).click();
  await page.getByLabel("Reason for cancelling", { exact: true }).fill("Recorded on the wrong shipment (E2E)");
  await page.getByRole("button", { name: "Cancel milestone" }).click();
  // the entry itself shows the result (its controls are gone once nothing is left to correct)
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(page.getByText("Recorded on the wrong shipment (E2E)", { exact: false })).toBeVisible();
});

test("doc officer revises the ETA and opens an exception that shows in the queue (AC-09, AC-10)", async ({ page }, info) => {
  test.skip(!shipmentUrl, "needs the shipment from the first test");
  await signIn(page, "doc.officer@ngb.example");
  await page.goto(shipmentUrl);
  const eta = page.locator("#eta");
  const local = new Date(Date.now() + 3 * 24 * 3600e3);
  const p = (n: number) => String(n).padStart(2, "0");
  await eta.getByLabel("New ETA", { exact: true })
    .fill(`${local.getFullYear()}-${p(local.getMonth() + 1)}-${p(local.getDate())}T10:00`);
  await eta.getByLabel("Reason", { exact: true }).selectOption("schedule_confirmed");
  await eta.getByLabel("Explanation", { exact: true }).fill("Vessel berthing confirmed (E2E)");
  await eta.getByRole("button", { name: "Update ETA" }).click();
  await expect(eta.getByText(/ETA updated\. This is a material change/)).toBeVisible();
  await expect(eta.getByText("ETA history (1)")).toBeVisible();

  const title = `Missing packing list (E2E ${info.project.name} ${stamp})`;
  const panel = page.locator("#exceptions");
  await panel.getByRole("button", { name: "Open an exception" }).click();
  await panel.getByLabel("Type", { exact: true }).selectOption("document_missing");
  await panel.getByLabel("Title", { exact: true }).fill(title);
  await panel.getByLabel("Next action", { exact: true }).fill("Ask the client for the packing list");
  await panel.getByRole("button", { name: "Open exception", exact: true }).click();
  await expect(panel.getByText(title)).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.goto("/admin/exceptions?filter=mine");
  await expect(page.getByText(title)).toBeVisible();
  await expect(page.getByText("Ask the client for the packing list").first()).toBeVisible();
  await expectNoHorizontalScroll(page);
});
