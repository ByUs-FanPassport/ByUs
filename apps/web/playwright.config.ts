import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
const localPort = Number(process.env.PLAYWRIGHT_PORT || 3000);
const localBaseUrl = `http://localhost:${localPort}`;

const engines = [
  { name: "chromium", use: devices["Desktop Chrome"] },
  { name: "webkit", use: devices["Desktop Safari"] },
  { name: "firefox", use: devices["Desktop Firefox"] },
] as const;

const viewports = [
  { name: "360", width: 360, height: 800 },
  { name: "1440", width: 1440, height: 1024 },
] as const;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  use: {
    baseURL: externalBaseUrl || localBaseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: engines.flatMap((engine) =>
    viewports.map((viewport) => ({
      name: `${engine.name}-${viewport.name}`,
      use: {
        ...engine.use,
        viewport: { width: viewport.width, height: viewport.height },
      },
    })),
  ),
  webServer: externalBaseUrl
    ? undefined
    : {
        command: `npm run build && npm run start:e2e -- --port ${localPort}`,
        url: localBaseUrl,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
