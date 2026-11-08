import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure", locale: "ar-SA", timezoneId: "Asia/Riyadh" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  // Start servers when not already running (CI). Locally the dev servers are reused.
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : [
        { command: "pnpm --filter @platform/web dev", url: `${baseURL}/ar/login`, reuseExistingServer: true, timeout: 180_000, cwd: "../.." },
        { command: "pnpm --filter @platform/worker dev", url: "http://localhost:3101", reuseExistingServer: true, timeout: 120_000, cwd: "../.." },
      ],
});
