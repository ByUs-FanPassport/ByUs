import "server-only";

import { createClient } from "@supabase/supabase-js";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { loadServerEnv } from "../config/env";
import { authorizeFanRequest } from "../fan-auth/fan-auth-gate";
import { createSupabaseFanAuthRepository } from "../fan-auth/supabase-fan-auth-repository";
import { createSupabaseProfileRepository } from "./profile-repository";
import type { ProfileRouteDependencies } from "./profile-route";

export function createProfileRouteDependencies(): ProfileRouteDependencies {
  const environment = loadServerEnv();
  const database = createClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const verifier = createPrivyNodeAccessVerifier({ appId: environment.PRIVY_APP_ID, appSecret: environment.PRIVY_APP_SECRET });
  const fanRepository = createSupabaseFanAuthRepository(
    { url: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY },
    database,
  );
  return {
    authorize: (authorization) => authorizeFanRequest({ authorization, verifier, repository: fanRepository }),
    repository: createSupabaseProfileRepository({ url: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }),
  };
}

export function profileUnavailableResponse(): Response {
  return Response.json({ error: { code: "PROFILE_UNAVAILABLE" } }, {
    status: 503,
    headers: { "cache-control": "no-store", vary: "Authorization" },
  });
}

