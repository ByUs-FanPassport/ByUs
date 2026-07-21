import "server-only";

import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { authorizeAdminSession } from "../admin/admin-session-gate";
import { createSupabaseAdminSessionRepository } from "../admin/supabase-admin-session-repository";
import { loadServerEnv } from "../config/env";
import { createSupabaseBlockchainJobRepository } from "./blockchain-job-repository";
import type { BlockchainJobRouteDependencies } from "./blockchain-job-route";

export function createBlockchainJobRouteDependencies(): BlockchainJobRouteDependencies {
  const environment = loadServerEnv();
  const verifier = createPrivyNodeAccessVerifier({ appId: environment.PRIVY_APP_ID, appSecret: environment.PRIVY_APP_SECRET });
  const sessionRepository = createSupabaseAdminSessionRepository({ url: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY });
  return {
    repository: createSupabaseBlockchainJobRepository({ url: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }),
    authorize: ({ authorization, correlationId }) => authorizeAdminSession({ authorization, correlationId, verifier, repository: sessionRepository }),
  };
}
