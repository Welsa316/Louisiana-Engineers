import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against the built server on 8787 and the seeded local
 * database. Build and migrate first:
 *   npm run build && npm run build -w server && npm run migrate
 * then `npm run e2e` (the global setup re-seeds before every run). The server runs in test mode so the dev-login and
 * dev-last-link routes exist.
 */
// E2E_PORT lets the suite run beside a dev server already on 8787; point
// DATABASE_URL at its own database too, since the global setup re-seeds it.
const port = process.env.E2E_PORT ?? "8787";
// One address per run for e2e/admin-bootstrap.spec.ts: a role revoked at the
// end of a run is never granted again, so the next run needs a fresh address.
// Set here so the server and the test workers both see it.
process.env.E2E_BOOTSTRAP_ADMIN ??= `bootstrap-admin-${Date.now()}@example.test`;
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/reseed.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: origin,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node server/dist/index.js",
    url: `${origin}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      NODE_ENV: "test",
      PORT: port,
      APP_ORIGIN: origin,
      JOBS_ENABLED: "false",
      // Specs that send real magic links give each test its own
      // X-Forwarded-For address, so repeated local runs against one database
      // do not exhaust the per-IP hourly limit (every request is 127.0.0.1).
      TRUST_PROXY: "true",
      ADMIN_EMAILS: process.env.E2E_BOOTSTRAP_ADMIN,
    },
  },
  projects: [
    {
      name: "mobile-375",
      testIgnore: /admin-bootstrap\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
    },
    {
      name: "desktop-1280",
      testIgnore: /admin-bootstrap\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    // A third administrator changes what the admin specs see (the
    // two-administrator minimum), so this one runs after both widths finish.
    {
      name: "admin-bootstrap",
      testMatch: /admin-bootstrap\.spec\.ts/,
      dependencies: ["mobile-375", "desktop-1280"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
});
