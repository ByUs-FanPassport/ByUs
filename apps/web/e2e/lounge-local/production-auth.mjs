// Verify the ordinary Next build rejects the synthetic identities accepted ONLY by
// our standalone test server. All configuration below is intentionally non-secret.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const child = spawn(process.execPath, [path.resolve(web, "../../node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "4185"], {
  cwd: web,
  env: {
    PATH: process.env.PATH, NODE_ENV: "production",
    NEXT_PUBLIC_APP_URL: "http://localhost:4185", NEXT_PUBLIC_PRIVY_APP_ID: "lounge-build-check", PRIVY_APP_ID: "lounge-build-check", PRIVY_APP_SECRET: "invalid-local-check-secret",
    NEXT_PUBLIC_BYUS_DATA_ENVIRONMENT: "development", BYUS_DATA_ENVIRONMENT: "development", NEXT_PUBLIC_PRIVY_APP_ENVIRONMENT: "development", PRIVY_APP_ENVIRONMENT: "development",
    NEXT_PUBLIC_PRIVY_APPLE_LOGIN_ENABLED: "false", PRIVY_APPLE_LOGIN_ENABLED: "false", NEXT_PUBLIC_PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: "false", PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: "false",
    SUPABASE_URL: "https://lounge-local-unreachable.invalid", SUPABASE_SERVICE_ROLE_KEY: "invalid-local-service-role-check-key", GIWA_CHAIN_ID: "91342",
    GIWA_RPC_URL: "https://lounge-local-unreachable.invalid", GIWA_EXPLORER_URL: "https://lounge-local-unreachable.invalid",
    BYUS_PASSPORT_CONTRACT_ADDRESS: "0x1111111111111111111111111111111111111111", BYUS_STAMP_CONTRACT_ADDRESS: "0x2222222222222222222222222222222222222222", BYUS_RELAYER_ADDRESS: "0x3333333333333333333333333333333333333333",
  }, stdio: ["ignore", "pipe", "pipe"],
});
try {
  await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Next startup timed out")), 20_000);
    child.stdout.on("data", (chunk) => { output += chunk; if (/Ready in/i.test(output)) { clearTimeout(timer); resolve(); } });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Next exited ${code}: ${output}`)); });
  });
  for (const url of ["/api/celebrities/elina/lounge", "/api/admin/lounge-messages"]) {
    for (const token of [null, "lounge-local-fan", "lounge-local-admin"]) {
      const response = await fetch(`http://127.0.0.1:4185${url}`, { method: url.includes("/celebrities/") ? "POST" : "GET", headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(10_000) });
      const body = await response.json();
      assert.equal(response.status, 401, `${url}: ${response.status} ${JSON.stringify(body)}`);
      assert.equal(body.error.code, url.startsWith("/api/admin/") && !token ? "UNAUTHENTICATED" : "AUTHENTICATION_REQUIRED");
    }
  }
  console.log("PASS ordinary Next production build rejects absent and synthetic fan/admin tokens on both lounge endpoints (6 checks)");
} finally { child.kill("SIGTERM"); }
