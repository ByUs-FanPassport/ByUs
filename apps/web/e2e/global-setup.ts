import { rm } from "node:fs/promises";
import path from "node:path";

const RUN_ID_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/;

export default async function globalSetup(): Promise<void> {
  const runId = process.env.BYUS_E2E_RUN_ID;
  if (!runId || !RUN_ID_PATTERN.test(runId)) {
    throw new Error("BYUS_E2E_RUN_ID must be a bounded filesystem-safe identifier");
  }
  const runDirectory = path.resolve(__dirname, "../../../artifacts/e2e/g6-release", runId);
  await rm(runDirectory, { recursive: true, force: true });
}
