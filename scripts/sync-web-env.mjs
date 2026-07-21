import { chmod, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const environment = process.argv[2];
if (environment !== "dev" && environment !== "prod") {
  throw new Error("usage: node scripts/sync-web-env.mjs <dev|prod>");
}

const prefix = environment === "dev" ? "DEV" : "PROD";
const required = {
  NEXT_PUBLIC_APP_URL:
    environment === "dev" ? "http://localhost:3000" : process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  PRIVY_APP_SECRET: process.env.PRIVY_APP_SECRET,
  SUPABASE_URL: process.env[`SUPABASE_${prefix}_URL`],
  SUPABASE_SERVICE_ROLE_KEY: process.env[`SUPABASE_${prefix}_SERVICE_ROLE_KEY`],
  GIWA_CHAIN_ID: process.env.GIWA_CHAIN_ID,
  GIWA_RPC_URL: process.env.GIWA_RPC_URL,
  GIWA_EXPLORER_URL: process.env.GIWA_EXPLORER_URL,
  BYUS_PASSPORT_CONTRACT_ADDRESS: process.env.BYUS_PASSPORT_CONTRACT_ADDRESS,
  BYUS_STAMP_CONTRACT_ADDRESS: process.env.BYUS_STAMP_CONTRACT_ADDRESS,
  BYUS_RELAYER_ADDRESS:
    environment === "prod"
      ? process.env.BYUS_PROD_RELAYER_ADDRESS
      : process.env.BYUS_RELAYER_ADDRESS,
};

const missing = Object.entries(required)
  .filter(([, value]) => typeof value !== "string" || value.length === 0)
  .map(([name]) => name);
if (missing.length > 0) {
  throw new Error(`missing required environment values: ${missing.join(", ")}`);
}

const destination = resolve("apps/web/.env.local");
const serialized = `${Object.entries(required)
  .map(([name, value]) => `${name}=${String(value).replaceAll("\n", "")}`)
  .join("\n")}\n`;
await writeFile(destination, serialized, { encoding: "utf8", mode: 0o600 });
await chmod(destination, 0o600);
console.log(`wrote ${destination} for ${environment}`);
