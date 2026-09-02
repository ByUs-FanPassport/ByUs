import { readEnvironmentFile, serializeEnvironment } from "./local-production-env.mjs";

export const DEVELOPMENT_SUPABASE_PROJECT_REF = "xcppyedwusirqnfpbtit";
export const DEVELOPMENT_ENV_PATH = ".env.web-dev.local";

const requiredSources = {
  privy: ["NEXT_PUBLIC_PRIVY_APP_ID", "PRIVY_APP_SECRET"],
  supabase: ["SUPABASE_DEV_URL", "SUPABASE_DEV_SERVICE_ROLE_KEY"],
  wallets: ["GIWA_RPC_URL", "GIWA_CHAIN_ID", "GIWA_EXPLORER_URL", "BYUS_RELAYER_ADDRESS"],
  contracts: ["BYUS_PASSPORT_CONTRACT_ADDRESS", "BYUS_STAMP_CONTRACT_ADDRESS"],
};

function requireValues(source, keys, label) {
  const missing = keys.filter((key) => !source[key]?.trim());
  if (missing.length) throw new Error(`${label} is missing: ${missing.join(", ")}`);
}

export async function developmentLocalEnvironment() {
  const [privy, supabase, wallets, contracts] = await Promise.all([
    readEnvironmentFile(".env.privy.local"),
    readEnvironmentFile(".env.supabase.local"),
    readEnvironmentFile(".env.wallets.local"),
    readEnvironmentFile(".env.contracts.local"),
  ]);
  for (const [label, keys] of Object.entries(requiredSources)) {
    requireValues({ privy, supabase, wallets, contracts }[label], keys, label);
  }
  const host = new URL(supabase.SUPABASE_DEV_URL).hostname;
  if (host !== `${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co`) {
    throw new Error(`refusing unexpected Dev Supabase host: ${host}`);
  }
  if (wallets.GIWA_CHAIN_ID !== "91342") throw new Error("Dev GIWA chain must be 91342");

  return {
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    NEXT_PUBLIC_PRIVY_APP_ID: privy.NEXT_PUBLIC_PRIVY_APP_ID,
    PRIVY_APP_ID: privy.NEXT_PUBLIC_PRIVY_APP_ID,
    PRIVY_APP_SECRET: privy.PRIVY_APP_SECRET,
    SUPABASE_URL: supabase.SUPABASE_DEV_URL,
    SUPABASE_SERVICE_ROLE_KEY: supabase.SUPABASE_DEV_SERVICE_ROLE_KEY,
    GIWA_CHAIN_ID: wallets.GIWA_CHAIN_ID,
    GIWA_RPC_URL: wallets.GIWA_RPC_URL,
    GIWA_EXPLORER_URL: wallets.GIWA_EXPLORER_URL,
    BYUS_PASSPORT_CONTRACT_ADDRESS: contracts.BYUS_PASSPORT_CONTRACT_ADDRESS,
    BYUS_STAMP_CONTRACT_ADDRESS: contracts.BYUS_STAMP_CONTRACT_ADDRESS,
    BYUS_RELAYER_ADDRESS: wallets.BYUS_RELAYER_ADDRESS,
    NEXT_PUBLIC_BYUS_DATA_ENVIRONMENT: "development",
    BYUS_DATA_ENVIRONMENT: "development",
    NEXT_PUBLIC_PRIVY_APP_ENVIRONMENT: "development",
    PRIVY_APP_ENVIRONMENT: "development",
    NEXT_PUBLIC_PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: "false",
    PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: "false",
  };
}

export async function assertDevelopmentLocalEnvironment(source) {
  const expected = await developmentLocalEnvironment();
  for (const [key, value] of Object.entries(expected)) {
    if (source[key] !== value) throw new Error(`local Development environment mismatch: ${key}`);
  }
  return expected;
}

export { serializeEnvironment };
