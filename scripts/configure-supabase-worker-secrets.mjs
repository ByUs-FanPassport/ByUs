import { chmod, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const environment = process.argv[2];
if (environment !== "dev" && environment !== "prod") {
  throw new Error("Usage: node scripts/configure-supabase-worker-secrets.mjs <dev|prod>");
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const upper = environment.toUpperCase();
const projectRef = required(`SUPABASE_${upper}_PROJECT_REF`);
const secrets = {
  BYUS_CRON_SECRET: required(`SUPABASE_${upper}_CRON_SECRET`),
  AWS_ACCESS_KEY_ID: required(`BYUS_${upper}_WORKER_INVOKER_ACCESS_KEY_ID`),
  AWS_SECRET_ACCESS_KEY: required(`BYUS_${upper}_WORKER_INVOKER_SECRET_ACCESS_KEY`),
  AWS_REGION: "ap-northeast-2",
  LAMBDA_FUNCTION_NAME: `byus-mint-worker-${environment}`,
  WORKER_ENVIRONMENT: environment,
};

const temporaryPath = join(tmpdir(), `byus-supabase-worker-${environment}-${randomUUID()}.env`);
try {
  await writeFile(
    temporaryPath,
    `${Object.entries(secrets).map(([name, value]) => `${name}=${value}`).join("\n")}\n`,
    { mode: 0o600 },
  );
  await chmod(temporaryPath, 0o600);
  const result = spawnSync(
    "supabase",
    ["secrets", "set", "--env-file", temporaryPath, "--project-ref", projectRef],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (result.status !== 0) throw new Error(`Supabase secrets set failed for ${environment}: ${result.stderr.trim()}`);
  process.stdout.write(`${JSON.stringify({ environment, projectRef, secretNames: Object.keys(secrets) })}\n`);
} finally {
  await unlink(temporaryPath).catch(() => undefined);
}
