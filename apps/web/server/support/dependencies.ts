import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { authorizeAdminSession } from "../admin/admin-session-gate";
import { createSupabaseAdminSessionRepository } from "../admin/supabase-admin-session-repository";
import { authorizeFanRequest } from "../fan-auth/fan-auth-gate";
import { createSupabaseFanAuthRepository } from "../fan-auth/supabase-fan-auth-repository";
import { loadServerEnv } from "../config/env";
import { createSupportHandlers } from "./routes";

export function supportHandlers() {
  const env = loadServerEnv();
  const config = { url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY };
  const database = createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const verifier = createPrivyNodeAccessVerifier({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET,
    appEnvironment: env.PRIVY_APP_ENVIRONMENT, testAccountLoginEnabled: env.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED, appleLoginEnabled: env.PRIVY_APPLE_LOGIN_ENABLED });
  const fans = createSupabaseFanAuthRepository(config, database);
  const admins = createSupabaseAdminSessionRepository(config);
  return createSupportHandlers({
    async rpc(name, args) {
      const { data, error } = await database.rpc(name, args);
      if (error) throw new Error(error.message);
      return data;
    },
    authorize: (authorization) => authorizeFanRequest({ authorization, verifier, repository: fans }),
    authorizeAdmin: (authorization, correlationId) => authorizeAdminSession({ authorization: authorization ?? "", correlationId, verifier, repository: admins }),
  });
}
