import {
  assertProductionLocalEnvironment,
  readEnvironmentFile,
} from "./local-production-env.mjs";

const environment = assertProductionLocalEnvironment(
  await readEnvironmentFile("apps/web/.env.local"),
);

console.log(
  `verified ${environment.NEXT_PUBLIC_APP_URL} + Production Supabase + Privy Development + GIWA ${environment.GIWA_CHAIN_ID}`,
);
