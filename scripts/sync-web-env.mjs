import { writeFile, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

import {
  productionLocalEnvironment,
  serializeEnvironment,
} from "./local-production-env.mjs";

if (process.argv[2] !== "prod-local") {
  throw new Error("usage: node scripts/sync-web-env.mjs prod-local");
}

const destination = resolve("apps/web/.env.local");
const awsProfile = process.env.BYUS_AWS_PROFILE ?? "coredot-dev";
const secretId = "byus/web/prod";

let secretSource;
try {
  secretSource = JSON.parse(
    execFileSync(
      "aws",
      [
        "secretsmanager",
        "get-secret-value",
        "--secret-id",
        secretId,
        "--query",
        "SecretString",
        "--output",
        "text",
        "--profile",
        awsProfile,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
} catch {
  throw new Error(
    `failed to read ${secretId} with AWS profile ${awsProfile}`,
  );
}

const environment = productionLocalEnvironment(secretSource);
await writeFile(destination, serializeEnvironment(environment), {
  encoding: "utf8",
  mode: 0o600,
});
await chmod(destination, 0o600);
console.log(
  "wrote apps/web/.env.local from AWS byus/web/prod for localhost + Production Supabase + Privy Development + GIWA 91342",
);
