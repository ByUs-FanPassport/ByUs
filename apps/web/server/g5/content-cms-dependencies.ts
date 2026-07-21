import "server-only";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { authorizeAdminSession } from "../admin/admin-session-gate";
import { createSupabaseAdminSessionRepository } from "../admin/supabase-admin-session-repository";
import { loadServerEnv } from "../config/env";
import { createContentCmsRepository } from "./content-cms";
import { invalidatePublicContentCache } from "../cache/public-content-revalidation";
export function createContentCmsDependencies() {
  const e = loadServerEnv(),
    v = createPrivyNodeAccessVerifier({
      appId: e.PRIVY_APP_ID,
      appSecret: e.PRIVY_APP_SECRET,
    }),
    s = createSupabaseAdminSessionRepository({
      url: e.SUPABASE_URL,
      serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
    });
  return {
    repository: createContentCmsRepository({
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
        verifier: v,
        repository: s,
      }),
    invalidatePublicContent: invalidatePublicContentCache,
  };
}
