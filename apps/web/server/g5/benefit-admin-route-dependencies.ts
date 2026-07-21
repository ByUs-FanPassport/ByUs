import "server-only";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { authorizeAdminSession } from "../admin/admin-session-gate";
import { createSupabaseAdminSessionRepository } from "../admin/supabase-admin-session-repository";
import { loadServerEnv } from "../config/env";
import { createSupabaseBenefitAdminRepository } from "./benefit-admin-repository";
import { invalidatePublicContentCache } from "../cache/public-content-revalidation";
export function createBenefitAdminRouteDependencies() {
  const e = loadServerEnv(),
    verifier = createPrivyNodeAccessVerifier({
      appId: e.PRIVY_APP_ID,
      appSecret: e.PRIVY_APP_SECRET,
    }),
    sessions = createSupabaseAdminSessionRepository({
      url: e.SUPABASE_URL,
      serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
    });
  return {
    repository: createSupabaseBenefitAdminRepository({
      url: e.SUPABASE_URL,
      serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
    }),
    authorize: ({
      authorization,
      correlationId,
    }: {
      authorization: string;
      correlationId: string;
    }) =>
      authorizeAdminSession({
        authorization,
        correlationId,
        verifier,
        repository: sessions,
      }),
    invalidatePublicContent: invalidatePublicContentCache,
  };
}
