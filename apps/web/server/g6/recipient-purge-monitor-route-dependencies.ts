import "server-only";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { authorizeAdminSession } from "../admin/admin-session-gate";
import { createSupabaseAdminSessionRepository } from "../admin/supabase-admin-session-repository";
import { loadServerEnv } from "../config/env";
import { createSupabaseRecipientPurgeMonitorRepository } from "./recipient-purge-monitor-repository";
import type { RecipientPurgeMonitorRouteDependencies } from "./recipient-purge-monitor-route";
export function createRecipientPurgeMonitorRouteDependencies(): RecipientPurgeMonitorRouteDependencies {
  const e = loadServerEnv(), verifier = createPrivyNodeAccessVerifier({ appId: e.PRIVY_APP_ID, appSecret: e.PRIVY_APP_SECRET, appEnvironment: e.PRIVY_APP_ENVIRONMENT, testAccountLoginEnabled: e.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED, appleLoginEnabled: e.PRIVY_APPLE_LOGIN_ENABLED });
  return {
    repository: createSupabaseRecipientPurgeMonitorRepository({ url: e.SUPABASE_URL, serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY }),
    authorize: ({ authorization, correlationId }) => authorizeAdminSession({ authorization, correlationId, verifier, repository: createSupabaseAdminSessionRepository({ url: e.SUPABASE_URL, serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY }) }),
    now: () => new Date(),
  };
}
