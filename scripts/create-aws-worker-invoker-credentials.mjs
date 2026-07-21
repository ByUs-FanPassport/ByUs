import { chmod, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const profile = process.env.AWS_PROFILE ?? "coredot-dev";

function aws(args, allowFailure = false) {
  const result = spawnSync("aws", [...args, "--profile", profile, "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`AWS CLI failed: ${args.slice(0, 3).join(" ")}`);
  }
  return result;
}

const values = {};
for (const environment of ["dev", "prod"]) {
  const upper = environment.toUpperCase();
  const userName = `byus-supabase-worker-invoker-${environment}`;
  const getUser = aws(["iam", "get-user", "--user-name", userName], true);
  if (getUser.status !== 0) aws(["iam", "create-user", "--user-name", userName]);

  aws([
    "iam",
    "put-user-policy",
    "--user-name",
    userName,
    "--policy-name",
    `byus-${environment}-worker-invoke-only`,
    "--policy-document",
    `file://${resolve(`infrastructure/aws/worker/${environment}-invoke-policy.json`)}`,
  ]);

  const existing = JSON.parse(aws([
    "iam",
    "list-access-keys",
    "--user-name",
    userName,
  ]).stdout).AccessKeyMetadata ?? [];
  if (existing.length !== 0) {
    throw new Error(`${userName} already has an access key; refusing to create an unrecoverable duplicate`);
  }
  const created = JSON.parse(aws([
    "iam",
    "create-access-key",
    "--user-name",
    userName,
  ]).stdout).AccessKey;
  values[`BYUS_${upper}_WORKER_INVOKER_ACCESS_KEY_ID`] = created.AccessKeyId;
  values[`BYUS_${upper}_WORKER_INVOKER_SECRET_ACCESS_KEY`] = created.SecretAccessKey;
}

const outputPath = resolve(".env.worker-invokers.local");
await writeFile(
  outputPath,
  `${Object.entries(values).map(([name, value]) => `${name}=${value}`).join("\n")}\n`,
  { mode: 0o600 },
);
await chmod(outputPath, 0o600);
process.stdout.write(`${JSON.stringify({ users: ["dev", "prod"], credentialsStored: outputPath, mode: "0600" })}\n`);
