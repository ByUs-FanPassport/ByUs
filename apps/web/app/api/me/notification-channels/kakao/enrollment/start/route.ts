import { createClient } from "@supabase/supabase-js";
import { createPrivyNodeAccessVerifier } from "@/server/auth/privy-node-verifier";
import { loadServerEnv } from "@/server/config/env";
import { authorizeFanRequest } from "@/server/fan-auth/fan-auth-gate";
import { createSupabaseFanAuthRepository } from "@/server/fan-auth/supabase-fan-auth-repository";
import { KakaoHttpConnectionPort, createKakaoEnrollmentStartHandler } from "@/server/notification/kakao-connection-route";
import { SupabaseKakaoConnectionRepository } from "@/server/notification/kakao-connection-repository";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const env = loadServerEnv();
    if (!env.KAKAO_ALIMTALK_ENROLLMENT_ENABLED || env.KAKAO_OAUTH_MODE !== "provider" || !env.KAKAO_CLIENT_ID || !env.KAKAO_CLIENT_SECRET || !env.KAKAO_REDIRECT_URI) throw new Error("not configured");
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const verifier = createPrivyNodeAccessVerifier({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET, appEnvironment: env.PRIVY_APP_ENVIRONMENT, testAccountLoginEnabled: env.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED, appleLoginEnabled: env.PRIVY_APPLE_LOGIN_ENABLED });
    const fans = createSupabaseFanAuthRepository({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }, db);
    return createKakaoEnrollmentStartHandler({ authorize: (authorization) => authorizeFanRequest({ authorization, verifier, repository: fans }), repository: new SupabaseKakaoConnectionRepository(db), port: new KakaoHttpConnectionPort({ clientId: env.KAKAO_CLIENT_ID, clientSecret: env.KAKAO_CLIENT_SECRET }), redirectUri: env.KAKAO_REDIRECT_URI })(request);
  } catch { return Response.json({ error: { code: "KAKAO_ENROLLMENT_UNAVAILABLE" } }, { status: 503, headers: { "cache-control": "no-store" } }); }
}
