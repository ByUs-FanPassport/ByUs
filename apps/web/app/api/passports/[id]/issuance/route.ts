import { createClient } from "@supabase/supabase-js";

import { createPrivyNodeAccessVerifier } from "../../../../../server/auth/privy-node-verifier";
import { authorizeFanRequest } from "../../../../../server/fan-auth/fan-auth-gate";
import { createSupabaseFanAuthRepository } from "../../../../../server/fan-auth/supabase-fan-auth-repository";
import { loadServerEnv } from "../../../../../server/config/env";
import { createSupabasePassportIssuanceRepository } from "../../../../../server/g2/passport-issuance-repository";
import { createPassportIssuanceHandler } from "../../../../../server/g2/passport-issuance-route";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const environment = loadServerEnv();
  const verifier = createPrivyNodeAccessVerifier({
    appId: environment.PRIVY_APP_ID,
    appSecret: environment.PRIVY_APP_SECRET,
    appEnvironment: environment.PRIVY_APP_ENVIRONMENT,
    testAccountLoginEnabled: environment.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED,
  });
  const database = createClient(
    environment.SUPABASE_URL,
    environment.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  const fanRepository = createSupabaseFanAuthRepository({
    url: environment.SUPABASE_URL,
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
  }, database);
  const issuanceRepository = createSupabasePassportIssuanceRepository({
    url: environment.SUPABASE_URL,
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
  }, database);
  const { id } = await context.params;

  return createPassportIssuanceHandler({
    authorize: (authorization) =>
      authorizeFanRequest({ authorization, verifier, repository: fanRepository }),
    repository: issuanceRepository,
  })(request, { passportId: id });
}
