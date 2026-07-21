import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL) throw new Error("PLAYWRIGHT_BASE_URL is required");
const APPROVED_LINKED_DEV_ORIGIN = "https://buyus.vercel.app";
if (baseURL.replace(/\/$/, "") !== APPROVED_LINKED_DEV_ORIGIN || process.env.BYUS_E2E_ALLOWED_BASE_URL?.replace(/\/$/, "") !== APPROVED_LINKED_DEV_ORIGIN) {
  throw new Error("E2E_DEPLOYMENT_BINDING_MISMATCH");
}
if (process.env.BYUS_E2E_ALLOW_MUTATION !== "I_UNDERSTAND_LINKED_DEV_MUTATION") {
  throw new Error("E2E_MUTATION_OPT_IN_REQUIRED");
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: path.join(os.tmpdir(), `byus-e2e-no-auth-artifacts-${process.env.BYUS_E2E_RUN_ID ?? "invalid"}`),
  use: {
    baseURL,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [{ name: "authenticated-no-retention", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1024 } } }],
});
