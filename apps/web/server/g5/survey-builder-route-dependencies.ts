import "server-only";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { authorizeAdminSession } from "../admin/admin-session-gate";
import { createSupabaseAdminSessionRepository } from "../admin/supabase-admin-session-repository";
import { loadServerEnv } from "../config/env";
import { createSupabaseSurveyBuilderRepository } from "./survey-builder-repository";
import type { SurveyBuilderRouteDependencies } from "./survey-builder-route";
export function createSurveyBuilderRouteDependencies(): SurveyBuilderRouteDependencies {
  const env = loadServerEnv();
  const verifier = createPrivyNodeAccessVerifier({
    appId: env.PRIVY_APP_ID,
    appSecret: env.PRIVY_APP_SECRET,
  });
  const session = createSupabaseAdminSessionRepository({
    url: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  });
  return {
    repository: createSupabaseSurveyBuilderRepository({
      url: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    }),
    authorize: ({ authorization, correlationId }) =>
      authorizeAdminSession({
        authorization,
        correlationId,
        verifier,
        repository: session,
      }),
  };
}
