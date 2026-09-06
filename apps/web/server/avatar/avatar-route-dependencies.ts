import "server-only";

import { PrivyClient } from "@privy-io/node";
import { createClient } from "@supabase/supabase-js";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { loadServerEnv } from "../config/env";
import { authorizeFanRequest } from "../fan-auth/fan-auth-gate";
import { createSupabaseFanAuthRepository } from "../fan-auth/supabase-fan-auth-repository";
import { createSupabaseAvatarRepository } from "./avatar-repository";
import { withAvatarRouteDefaults, type AvatarRouteDependencies } from "./avatar-route";

function bearer(authorization: string): string {
  const match = /^Bearer[ \t]+([^\s]+)$/i.exec(authorization.trim());
  if (!match) throw new Error("Privy bearer token is required");
  return match[1];
}

export function createAvatarRouteDependencies(): AvatarRouteDependencies {
  const environment = loadServerEnv();
  const database = createClient(
    environment.SUPABASE_URL,
    environment.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  const privy = new PrivyClient({
    appId: environment.PRIVY_APP_ID,
    appSecret: environment.PRIVY_APP_SECRET,
  });
  const verifier = createPrivyNodeAccessVerifier(
    {
      appId: environment.PRIVY_APP_ID,
      appSecret: environment.PRIVY_APP_SECRET,
      appEnvironment: environment.PRIVY_APP_ENVIRONMENT,
      testAccountLoginEnabled: environment.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED,
      appleLoginEnabled: environment.PRIVY_APPLE_LOGIN_ENABLED,
    },
    privy,
  );
  const fanRepository = createSupabaseFanAuthRepository(
    { url: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY },
    database,
  );

  return withAvatarRouteDefaults({
    authorize: (authorization) =>
      authorizeFanRequest({ authorization, verifier, repository: fanRepository }),
    repository: createSupabaseAvatarRepository({
      url: environment.SUPABASE_URL,
      serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
    }),
    async getVerifiedGoogleSubject(authorization) {
      const claims = await privy.utils().auth().verifyAccessToken(bearer(authorization));
      if (claims.app_id !== environment.PRIVY_APP_ID) throw new Error("Privy application mismatch");
      const user = await privy.users()._get(claims.user_id);
      if (user.id !== claims.user_id) throw new Error("Privy token subject mismatch");
      const google = user.linked_accounts
        .filter(
          (account) =>
            account.type === "google_oauth" &&
            typeof account.subject === "string" &&
            account.subject.length > 0 &&
            typeof account.verified_at === "number" &&
            account.verified_at > 0,
        )
        .sort((left, right) => (right.verified_at ?? 0) - (left.verified_at ?? 0))[0];
      return google?.type === "google_oauth" ? google.subject : null;
    },
  });
}

export function avatarUnavailableResponse(): Response {
  return Response.json(
    { error: { code: "AVATAR_UNAVAILABLE" } },
    {
      status: 503,
      headers: { "cache-control": "private, no-store", vary: "Authorization" },
    },
  );
}
