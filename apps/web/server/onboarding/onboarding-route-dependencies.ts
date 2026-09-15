import "server-only";

import { createClient } from "@supabase/supabase-js";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { loadServerEnv } from "../config/env";
import { authorizeFanRequest } from "../fan-auth/fan-auth-gate";
import { createSupabaseFanAuthRepository } from "../fan-auth/supabase-fan-auth-repository";
import { createSupabaseOnboardingRepository } from "./onboarding-repository";
import type { OnboardingRouteDependencies } from "./onboarding-route";

export function createOnboardingRouteDependencies(): OnboardingRouteDependencies {
  const environment = loadServerEnv();
  const database = createClient(
    environment.SUPABASE_URL,
    environment.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  const verifier = createPrivyNodeAccessVerifier({
    appId: environment.PRIVY_APP_ID,
    appSecret: environment.PRIVY_APP_SECRET,
    appEnvironment: environment.PRIVY_APP_ENVIRONMENT,
    testAccountLoginEnabled: environment.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED,
    appleLoginEnabled: environment.PRIVY_APPLE_LOGIN_ENABLED,
  });
  const config = {
    url: environment.SUPABASE_URL,
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
  };

  return {
    authorize: (authorization) =>
      authorizeFanRequest({
        authorization,
        verifier,
        repository: createSupabaseFanAuthRepository(config, database),
      }),
    repository: createSupabaseOnboardingRepository(config, database),
  };
}

export function onboardingUnavailableResponse(): Response {
  return Response.json(
    { error: { code: "ONBOARDING_UNAVAILABLE" } },
    {
      status: 503,
      headers: {
        "cache-control": "private, no-store",
        vary: "Authorization",
      },
    },
  );
}
