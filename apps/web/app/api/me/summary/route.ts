import { createClient } from "@supabase/supabase-js";
import { AuthError } from "@/features/auth/domain/auth-errors";
import { createPrivyNodeAccessVerifier } from "@/server/auth/privy-node-verifier";
import { loadServerEnv } from "@/server/config/env";
import { authorizeFanRequest } from "@/server/fan-auth/fan-auth-gate";
import { createSupabaseFanAuthRepository } from "@/server/fan-auth/supabase-fan-auth-repository";
import { createSupabaseMySummaryRepository } from "@/server/my/my-summary-repository";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store", vary: "Authorization" } as const;

export async function GET(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const locale = new URL(request.url).searchParams.get("locale") === "en" ? "en" : "ko";
  try {
    const environment = loadServerEnv();
    const database = createClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const fan = await authorizeFanRequest({
      authorization,
      verifier: createPrivyNodeAccessVerifier({ appId: environment.PRIVY_APP_ID, appSecret: environment.PRIVY_APP_SECRET, appEnvironment: environment.PRIVY_APP_ENVIRONMENT, testAccountLoginEnabled: environment.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED }),
      repository: createSupabaseFanAuthRepository({ url: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }, database),
    });
    const summary = await createSupabaseMySummaryRepository({ url: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }, database).get({ appUserId: fan.appUserId, locale, asOf: new Date() });
    return Response.json({ summary }, { headers });
  } catch (error) {
    if (error instanceof AuthError) return Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: error.status, headers });
    return Response.json({ error: { code: "MY_SUMMARY_UNAVAILABLE" } }, { status: 503, headers });
  }
}
