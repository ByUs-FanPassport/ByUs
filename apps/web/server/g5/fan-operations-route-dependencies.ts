import "server-only";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { authorizeAdminSession } from "../admin/admin-session-gate";
import { createSupabaseAdminSessionRepository } from "../admin/supabase-admin-session-repository";
import { loadServerEnv } from "../config/env";
import { createSupabaseFanOperationsRepository } from "./fan-operations-repository";
import { PrivyClient } from "@privy-io/node";
import { createClient } from "@supabase/supabase-js";
import { createFanProviderReader, withFanAccountInfo } from "./fan-account-info";
import type { FanOperationsRouteDependencies } from "./fan-operations-route";
export function createFanOperationsRouteDependencies(): FanOperationsRouteDependencies {
  const env = loadServerEnv();
  const privy = new PrivyClient({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET });
  const verifier = createPrivyNodeAccessVerifier({
    appId: env.PRIVY_APP_ID,
    appSecret: env.PRIVY_APP_SECRET,
    appEnvironment: env.PRIVY_APP_ENVIRONMENT,
    testAccountLoginEnabled: env.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED,
    appleLoginEnabled: env.PRIVY_APPLE_LOGIN_ENABLED,
  }, privy);
  const config = { url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY };
  const database = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const sessions = createSupabaseAdminSessionRepository(config);
  return {
    repository: withFanAccountInfo(
      createSupabaseFanOperationsRepository(config, database),
      database,
      createFanProviderReader({ appId: env.PRIVY_APP_ID, client: privy }),
    ),
    authorize: ({ authorization, correlationId }) =>
      authorizeAdminSession({ authorization, correlationId, verifier, repository: sessions }),
  };
}
export function fanOperationsUnavailable():Response{return Response.json({error:{code:"FAN_OPERATIONS_UNAVAILABLE"}},{status:503,headers:{"cache-control":"private, no-store",vary:"Authorization"}});}
