import { spawn } from "node:child_process";

function run(command, args, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

let originalFailure;
try {
  // Read-only identity/project/deployment validation always runs before mutation.
  await run(process.execPath, ["scripts/seed-kara-nualeaf-e2e-fixture.mjs", "preflight"]);
  await run(process.execPath, ["scripts/seed-kara-nualeaf-e2e-fixture.mjs", "seed"]);
  await run("npx", ["playwright", "test", "e2e/operations/kara-nualeaf-live-benefit.spec.ts", "--config=playwright.authenticated.config.ts"], new URL("../apps/web", import.meta.url));
} catch (error) {
  originalFailure = error;
}

if (originalFailure) {
  try {
    await run(process.execPath, ["scripts/seed-kara-nualeaf-e2e-fixture.mjs", "cleanup"]);
  } catch (cleanupError) {
    console.error("E2E_GUARDED_CLEANUP_FAILED", cleanupError instanceof Error ? cleanupError.message : cleanupError);
  }
  throw originalFailure;
}
