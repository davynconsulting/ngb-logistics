import { defineConfig, devices } from "@playwright/test";

// Locally the seeded test password comes from .env.local; in CI set E2E_PASSWORD
// (and the NEXT_PUBLIC_SUPABASE_* variables) as secrets.
try {
  process.loadEnvFile(".env.local");
} catch {
  /* no .env.local (CI) */
}

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL, trace: "on-first-retry" },
  projects: [
    // Mobile-first: the client portal must work on common phone sizes (AC-17).
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // CI builds first and tests the production server; locally the dev server is fine
    command: process.env.CI ? "npm run start" : "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
