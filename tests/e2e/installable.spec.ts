import { expect, test } from "@playwright/test";

// Sprint 5: the PWA is installable by Chrome's own criteria (manifest, icons, service worker, HTTPS or
// localhost). Lighthouse no longer scores PWAs, so this asks Chrome directly through DevTools.

test("Chrome reports no installability errors", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "installability is a Chromium DevTools check");
  await page.goto("/");
  // the service worker must be registered and active
  const scope = await page.evaluate(async () => {
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 15_000))]);
    return reg?.scope ?? null;
  });
  expect(scope, "service worker active").toMatch(/\/$/);
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  expect(installabilityErrors.map((e) => e.errorId)).toEqual([]);
  const { url, errors } = await cdp.send("Page.getAppManifest");
  expect(url).toMatch(/manifest\.webmanifest$/);
  expect(errors.filter((e) => e.critical)).toEqual([]);
});
