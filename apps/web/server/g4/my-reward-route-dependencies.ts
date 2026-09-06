import "server-only";

import { createClient } from "@supabase/supabase-js";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { loadServerEnv } from "../config/env";
import { authorizeFanRequest } from "../fan-auth/fan-auth-gate";
import { createSupabaseFanAuthRepository } from "../fan-auth/supabase-fan-auth-repository";
import { createSupabaseMyRewardRepository } from "./my-reward-repository";
import type { MyRewardRouteDependencies } from "./my-reward-route";

export function createMyRewardRouteDependencies(): MyRewardRouteDependencies {
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
    testAccountLoginEnabled: environment.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED, appleLoginEnabled: environment.PRIVY_APPLE_LOGIN_ENABLED,
  });
  const fanRepository = createSupabaseFanAuthRepository(
    {
      url: environment.SUPABASE_URL,
      serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
    },
    database,
  );
  return {
    authorize: (authorization) =>
      authorizeFanRequest({ authorization, verifier, repository: fanRepository }),
    repository: createSupabaseMyRewardRepository(
      {
        url: environment.SUPABASE_URL,
        serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
      },
      database,
    ),
  };
}

export function myRewardUnavailableResponse(): Response {
  return Response.json(
    { error: { code: "REWARDS_UNAVAILABLE" } },
    {
      status: 503,
      headers: { "cache-control": "no-store", vary: "Authorization" },
    },
  );
}
