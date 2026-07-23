import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";

const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");

function canReservePort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") resolve(false);
      else reject(error);
    });
    // Bind the wildcard host so an IPv6-only listener on localhost is not
    // mistaken for an available Privy-allowlisted port.
    server.listen(port, () => {
      server.close((error) => error ? reject(error) : resolve(true));
    });
  });
}

async function selectPrivyAllowedPort() {
  const candidates = process.env.PLAYWRIGHT_PORT
    ? [Number(process.env.PLAYWRIGHT_PORT)]
    : [3000, 5173];
  for (const candidate of candidates) {
    if (await canReservePort(candidate)) return candidate;
  }
  throw new Error("Privy가 허용한 localhost:3000 및 localhost:5173 포트를 사용할 수 없습니다.");
}

if (process.env.PLAYWRIGHT_BASE_URL?.trim()) {
  throw new Error("The public E2E runner is local-only; use the guarded deployed-Dev operations runner for PLAYWRIGHT_BASE_URL");
}
const port = String(await selectPrivyAllowedPort());
const runId = process.env.BYUS_E2E_RUN_ID?.trim()
  || `local-public-${new Date().toISOString().replace(/[.:]/g, "-")}`;
console.log(`BYUS public E2E run: ${runId}`);
const child = spawn(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)], {
  env: {
    ...process.env,
    ...(port ? { PLAYWRIGHT_PORT: port } : {}),
    BYUS_E2E_RUN_ID: runId,
  },
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
