import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL || !/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(baseURL))
  throw new Error("PHASE4_E2E_LOCALHOST_REQUIRED");
if (process.env.BYUS_E2E_ALLOW_DEV_LOCAL !== "I_UNDERSTAND_DEV_DB_MUTATION")
  throw new Error("PHASE4_E2E_DEV_MUTATION_OPT_IN_REQUIRED");
const storageState = process.env.BYUS_PHASE4_STORAGE_STATE_PATH;
if (!storageState) throw new Error("BYUS_PHASE4_STORAGE_STATE_PATH is required");

export default defineConfig({
  testDir: "./e2e/operations",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: path.join(process.cwd(), "../../artifacts/e2e/phase4-results"),
  use: { baseURL, storageState, trace: "retain-on-failure", video: "off" },
  projects: [
    {
      name: "chromium-360",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 360, height: 800 },
      },
    },
    {
      name: "chromium-1440",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1024 },
      },
    },
  ],
});
