import { expect, type Page } from "@playwright/test";
import { computeCheckDigit } from "../../lib/domain/container-number";

/** Password of the seeded, fictional test users (dev project only). */
export const PASSWORD = process.env.E2E_PASSWORD ?? process.env.SEED_USER_PASSWORD ?? "";

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** A valid, unique-ish ISO 6346 container number, e.g. NGBU4821733. */
export function containerNumber(seed: number): string {
  const base = `NGBU${String(seed % 1_000_000).padStart(6, "0")}`;
  return base + computeCheckDigit(base);
}

/** A tiny but valid PDF for upload tests (fictional content). */
export function samplePdf(label: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% NGB E2E ${label} (fictional)\n%%EOF\n`);
}
