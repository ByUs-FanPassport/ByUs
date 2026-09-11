import "server-only";
import { createClient } from "@supabase/supabase-js";
import { authorizeAdminSession } from "../admin/admin-session-gate";
import { createSupabaseAdminSessionRepository } from "../admin/supabase-admin-session-repository";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { loadServerEnv } from "../config/env";
import { invalidatePublicContentCache } from "../cache/public-content-revalidation";
import { createPublicImageRepository } from "./public-image-repository";

export function createPublicImageRouteDependencies() {
  const env = loadServerEnv();
  const database = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const verifier = createPrivyNodeAccessVerifier({
    appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET, appEnvironment: env.PRIVY_APP_ENVIRONMENT,
    testAccountLoginEnabled: env.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED, appleLoginEnabled: env.PRIVY_APPLE_LOGIN_ENABLED,
  });
  const sessions = createSupabaseAdminSessionRepository({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }, database);
  return {
    repository: createPublicImageRepository({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }, database),
    authorize: ({ authorization, correlationId }: { authorization: string; correlationId: string }) => authorizeAdminSession({ authorization, correlationId, verifier, repository: sessions }),
    invalidatePublicContent: invalidatePublicContentCache,
  };
}
