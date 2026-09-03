import "server-only";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { authorizeAdminSession } from "../admin/admin-session-gate";
import { createSupabaseAdminSessionRepository } from "../admin/supabase-admin-session-repository";
import { loadServerEnv } from "../config/env";
import { createSupabaseBenefitDrawRepository } from "./benefit-draw-repository";

export function createBenefitDrawRouteDependencies() {
  const environment = loadServerEnv();
  const verifier = createPrivyNodeAccessVerifier({ appId: environment.PRIVY_APP_ID, appSecret: environment.PRIVY_APP_SECRET });
  const sessions = createSupabaseAdminSessionRepository({ url: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY });
  return {
    repository: createSupabaseBenefitDrawRepository({ url: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }),
    authorize: ({ authorization, correlationId }: { authorization: string; correlationId: string }) =>
      authorizeAdminSession({ authorization, correlationId, verifier, repository: sessions }),
    now: () => new Date(),
  };
}
