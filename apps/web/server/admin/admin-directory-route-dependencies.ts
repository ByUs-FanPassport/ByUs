import "server-only";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { loadServerEnv } from "../config/env";
import { authorizeAdminSession } from "./admin-session-gate";
import { createSupabaseAdminSessionRepository } from "./supabase-admin-session-repository";
import { createAdminDirectoryRepository } from "./admin-directory-repository";
import { createAdminDirectoryHandlers } from "./admin-directory-route";

export function createAdminDirectoryRouteDependencies() {
  const env = loadServerEnv();
  const config = { url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY };
  const verifier = createPrivyNodeAccessVerifier({
    appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET,
    appEnvironment: env.PRIVY_APP_ENVIRONMENT, testAccountLoginEnabled: env.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED,
    appleLoginEnabled: env.PRIVY_APPLE_LOGIN_ENABLED,
  });
  const repository = createSupabaseAdminSessionRepository(config);
  return createAdminDirectoryHandlers({
    authorize: (input) => authorizeAdminSession({ ...input, verifier, repository }),
    repository: createAdminDirectoryRepository(config),
  });
}
