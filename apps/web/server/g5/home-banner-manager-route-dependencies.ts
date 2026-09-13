import "server-only";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { authorizeAdminSession, type AdminSession } from "../admin/admin-session-gate";
import { createSupabaseAdminSessionRepository } from "../admin/supabase-admin-session-repository";
import { invalidatePublicContentCache } from "../cache/public-content-revalidation";
import { loadServerEnv } from "../config/env";
import { createHomeBannerManagerRepository, type HomeBannerManagerRepository } from "./home-banner-manager-repository";

export interface HomeBannerManagerDependencies {
  authorize(input: { authorization: string; correlationId: string }): Promise<AdminSession>;
  repository: HomeBannerManagerRepository;
  invalidatePublicContent(): void;
}
export function createHomeBannerManagerDependencies(): HomeBannerManagerDependencies {
  const env = loadServerEnv();
  const verifier = createPrivyNodeAccessVerifier({
    appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET,
    appEnvironment: env.PRIVY_APP_ENVIRONMENT,
    testAccountLoginEnabled: env.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED,
    appleLoginEnabled: env.PRIVY_APPLE_LOGIN_ENABLED,
  });
  const sessions = createSupabaseAdminSessionRepository({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
  return {
    repository: createHomeBannerManagerRepository({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }),
    authorize: (input) => authorizeAdminSession({ ...input, verifier, repository: sessions }),
    invalidatePublicContent: invalidatePublicContentCache,
  };
}
