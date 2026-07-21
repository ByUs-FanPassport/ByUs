import "server-only";

import { createClient } from "@supabase/supabase-js";

import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { loadServerEnv } from "../config/env";
import { authorizeFanRequest } from "../fan-auth/fan-auth-gate";
import { createSupabaseFanAuthRepository } from "../fan-auth/supabase-fan-auth-repository";
import { createLiveSurveyRepositoryFromEnvironment } from "./live-survey-repository";
import type { LiveSurveyRouteDependencies } from "./live-survey-route";

export function createLiveSurveyRouteDependencies(): LiveSurveyRouteDependencies {
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
    repository: createLiveSurveyRepositoryFromEnvironment({
      url: environment.SUPABASE_URL,
      serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
    }),
  };
}

export function liveSurveyUnavailableResponse(): Response {
  return Response.json({ error: { code: "SURVEY_UNAVAILABLE" } }, {
    status: 503,
    headers: { "cache-control": "private, no-store", vary: "Authorization" },
  });
}
