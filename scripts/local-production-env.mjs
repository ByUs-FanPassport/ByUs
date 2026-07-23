import { readFile } from "node:fs/promises";

export const PRODUCTION_SUPABASE_PROJECT_REF = "gmrykvmtmuaeswpajteq";
export const LOCAL_APP_URL = "http://localhost:3000";
export const DEMO_PRIVY_ENVIRONMENT = "development";

const requiredKeys = [
  "NEXT_PUBLIC_PRIVY_APP_ID",
  "PRIVY_APP_ID",
  "PRIVY_APP_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GIWA_CHAIN_ID",
  "GIWA_RPC_URL",
  "GIWA_EXPLORER_URL",
  "BYUS_PASSPORT_CONTRACT_ADDRESS",
  "BYUS_STAMP_CONTRACT_ADDRESS",
  "BYUS_RELAYER_ADDRESS",
  "NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY",
];

function decodeValue(rawValue) {
  const value = rawValue.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    if (value.startsWith('"')) {
      try {
        return JSON.parse(value);
      } catch {
        return value.slice(1, -1);
      }
    }
    return value.slice(1, -1);
  }
  return value;
}

export function parseEnvironmentFile(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        if (separator < 1) throw new Error("invalid environment file");
        return [
          line.slice(0, separator).replace(/^export\s+/, "").trim(),
          decodeValue(line.slice(separator + 1)),
        ];
      }),
  );
}

export async function readEnvironmentFile(path) {
  return parseEnvironmentFile(await readFile(path, "utf8"));
}

export function productionLocalEnvironment(source) {
  const missing = requiredKeys.filter((key) => {
    const value = source[key]?.trim();
    return !value || value.toLowerCase() === "placeholder";
  });
  if (missing.length > 0) {
    throw new Error(
      `Vercel Production environment is missing required values: ${missing.join(", ")}`,
    );
  }

  let supabaseHost;
  try {
    supabaseHost = new URL(source.SUPABASE_URL).hostname;
  } catch {
    throw new Error("Vercel Production SUPABASE_URL is invalid");
  }
  if (
    supabaseHost !== `${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`
  ) {
    throw new Error(
      `refusing non-production Supabase host: ${supabaseHost || "unknown"}`,
    );
  }
  if (source.PRIVY_APP_ID !== source.NEXT_PUBLIC_PRIVY_APP_ID) {
    throw new Error("Production Privy server and public app IDs do not match");
  }
  if (source.GIWA_CHAIN_ID !== "91342") {
    throw new Error("Production GIWA chain must be 91342");
  }

  return {
    ...Object.fromEntries(
      requiredKeys.map((key) => [key, source[key].replaceAll("\n", "")]),
    ),
    NEXT_PUBLIC_APP_URL: LOCAL_APP_URL,
    NEXT_PUBLIC_BYUS_DATA_ENVIRONMENT: "production",
    BYUS_DATA_ENVIRONMENT: "production",
    NEXT_PUBLIC_PRIVY_APP_ENVIRONMENT: DEMO_PRIVY_ENVIRONMENT,
    PRIVY_APP_ENVIRONMENT: DEMO_PRIVY_ENVIRONMENT,
    NEXT_PUBLIC_PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: "false",
    PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: "false",
  };
}

export function serializeEnvironment(source) {
  return `${Object.entries(source)
    .map(([key, value]) => `${key}=${String(value).replaceAll("\n", "")}`)
    .join("\n")}\n`;
}

export function assertProductionLocalEnvironment(source) {
  const environment = productionLocalEnvironment(source);
  for (const [key, expected] of Object.entries(environment)) {
    if (source[key] !== expected) {
      throw new Error(`local Production environment mismatch: ${key}`);
    }
  }
  return environment;
}
