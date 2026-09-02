import { spawn } from "node:child_process";
import { assertDevelopmentLocalEnvironment, DEVELOPMENT_ENV_PATH } from "./local-development-env.mjs";
import { readEnvironmentFile } from "./local-production-env.mjs";

const environment = await assertDevelopmentLocalEnvironment(await readEnvironmentFile(DEVELOPMENT_ENV_PATH));
console.log(`verified ${environment.NEXT_PUBLIC_APP_URL} + Dev Supabase + Privy Development + GIWA ${environment.GIWA_CHAIN_ID}`);

const child = spawn("npm", ["run", "dev", "--workspace", "@byus/web"], {
  cwd: process.cwd(),
  env: { ...process.env, ...environment },
  stdio: "inherit",
});
child.once("error", (error) => { throw error; });
child.once("exit", (code, signal) => process.exitCode = signal ? 1 : (code ?? 1));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}
