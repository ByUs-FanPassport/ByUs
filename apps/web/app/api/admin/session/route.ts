import { createPrivyNodeAccessVerifier } from "../../../../server/auth/privy-node-verifier";
import { authorizeAdminSession } from "../../../../server/admin/admin-session-gate";
import { createAdminSessionHandler } from "../../../../server/admin/admin-session-route";
import { createSupabaseAdminSessionRepository } from "../../../../server/admin/supabase-admin-session-repository";
import { loadServerEnv } from "../../../../server/config/env";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const environment = loadServerEnv();
  const verifier = createPrivyNodeAccessVerifier({
    appId: environment.PRIVY_APP_ID,
    appSecret: environment.PRIVY_APP_SECRET,
  });
  const repository = createSupabaseAdminSessionRepository({
    url: environment.SUPABASE_URL,
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
  });
  return createAdminSessionHandler({
    authorize: ({ authorization, correlationId }) =>
      authorizeAdminSession({ authorization, correlationId, verifier, repository }),
  })(request);
}
