import "server-only";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { authorizeAdminSession } from "../admin/admin-session-gate";
import { createSupabaseAdminSessionRepository } from "../admin/supabase-admin-session-repository";
import { loadServerEnv } from "../config/env";
import { createSupabaseLiveManagerRepository } from "./live-manager-repository";

export function createLiveManagerRouteDependencies() {
  const env = loadServerEnv();
  const verifier = createPrivyNodeAccessVerifier({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET });
  const sessions = createSupabaseAdminSessionRepository({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
  return {
    repository: createSupabaseLiveManagerRepository({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }),
    authorize: ({ authorization, correlationId }: { authorization: string; correlationId: string }) => authorizeAdminSession({ authorization, correlationId, verifier, repository: sessions }),
  };
}
