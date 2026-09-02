import { assertDevelopmentLocalEnvironment, DEVELOPMENT_ENV_PATH } from "./local-development-env.mjs";
import { readEnvironmentFile } from "./local-production-env.mjs";

const environment = await assertDevelopmentLocalEnvironment(await readEnvironmentFile(DEVELOPMENT_ENV_PATH));
console.log(`verified ${environment.NEXT_PUBLIC_APP_URL} + Dev Supabase + Privy Development + GIWA ${environment.GIWA_CHAIN_ID}`);
