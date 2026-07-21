import "server-only";

import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { authorizeAdminSession } from "../admin/admin-session-gate";
import { createSupabaseAdminSessionRepository } from "../admin/supabase-admin-session-repository";
import { loadServerEnv } from "../config/env";
import { createAuditLogRepository } from "./audit-log-repository";

export function createAuditLogRouteDependencies() {
  const environment = loadServerEnv();
  const verifier = createPrivyNodeAccessVerifier({ appId: environment.PRIVY_APP_ID, appSecret: environment.PRIVY_APP_SECRET });
  const adminRepository = createSupabaseAdminSessionRepository({ url: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY });
  return {
    authorize: ({ authorization, correlationId }: { authorization: string; correlationId: string }) =>
      authorizeAdminSession({ authorization, correlationId, verifier, repository: adminRepository }),
    repository: createAuditLogRepository({ url: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }),
  };
}
