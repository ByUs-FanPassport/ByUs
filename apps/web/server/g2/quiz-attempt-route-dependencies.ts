import "server-only";

import { createClient } from "@supabase/supabase-js";

import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { loadServerEnv } from "../config/env";
import { authorizeFanRequest } from "../fan-auth/fan-auth-gate";
import { createSupabaseFanAuthRepository } from "../fan-auth/supabase-fan-auth-repository";
import { createSupabaseQuizAttemptRepository } from "./quiz-attempt-repository";
import type { QuizAttemptHandlerDependencies } from "./quiz-attempt-route";

export function createQuizAttemptHandlerDependencies(): QuizAttemptHandlerDependencies {
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
  const fanRepository = createSupabaseFanAuthRepository(
    {
      url: environment.SUPABASE_URL,
      serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
    },
    database,
  );
  const repository = createSupabaseQuizAttemptRepository(
    {
      url: environment.SUPABASE_URL,
      serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
    },
    database,
  );

  return {
    authorize: (authorization) =>
      authorizeFanRequest({ authorization, verifier, repository: fanRepository }),
    repository,
  };
}

export function quizAttemptUnavailableResponse(): Response {
  return Response.json(
    { error: { code: "QUIZ_UNAVAILABLE" } },
    {
      status: 503,
      headers: { "cache-control": "no-store", vary: "Authorization" },
    },
  );
}
