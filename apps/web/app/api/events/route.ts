import { createClient } from "@supabase/supabase-js";

import { createPrivyNodeAccessVerifier } from "@/server/auth/privy-node-verifier";
import { loadServerEnv } from "@/server/config/env";
import { authorizeFanRequest } from "@/server/fan-auth/fan-auth-gate";
import { createSupabaseFanAuthRepository } from "@/server/fan-auth/supabase-fan-auth-repository";
import { createSupabaseProductEventRepository } from "@/server/analytics/product-event-repository";
import { createRecordProductEventHandler } from "@/server/analytics/product-event-route";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const environment = loadServerEnv();
    const database = createClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const verifier = createPrivyNodeAccessVerifier({
      appId: environment.PRIVY_APP_ID,
      appSecret: environment.PRIVY_APP_SECRET,
      appEnvironment: environment.PRIVY_APP_ENVIRONMENT,
      testAccountLoginEnabled: environment.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED, appleLoginEnabled: environment.PRIVY_APPLE_LOGIN_ENABLED,
    });
    const fanRepository = createSupabaseFanAuthRepository({
      url: environment.SUPABASE_URL,
      serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
    }, database);
    return createRecordProductEventHandler({
      identify: (authorization) => authorization
        ? authorizeFanRequest({ authorization, verifier, repository: fanRepository })
        : Promise.resolve(null),
      repository: createSupabaseProductEventRepository({
        url: environment.SUPABASE_URL,
        serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
      }, database),
      now: () => new Date(),
    })(request);
  } catch {
    return Response.json({ error: { code: "EVENT_UNAVAILABLE" } }, {
      status: 503,
      headers: { "cache-control": "no-store", vary: "Authorization" },
    });
  }
}
