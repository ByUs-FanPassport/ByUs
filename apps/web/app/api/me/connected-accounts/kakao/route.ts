import { createClient } from "@supabase/supabase-js";
import { createPrivyNodeAccessVerifier } from "../../../../../server/auth/privy-node-verifier";
import { loadServerEnv } from "../../../../../server/config/env";
import { authorizeFanRequest } from "../../../../../server/fan-auth/fan-auth-gate";
import { createSupabaseFanAuthRepository } from "../../../../../server/fan-auth/supabase-fan-auth-repository";
import { createKakaoDisconnectHandler, KakaoHttpConnectionPort } from "../../../../../server/notification/kakao-connection-route";
import { SupabaseKakaoConnectionRepository } from "../../../../../server/notification/kakao-connection-repository";
export const dynamic="force-dynamic";
export async function DELETE(request:Request){try{const e=loadServerEnv();const db=createClient(e.SUPABASE_URL,e.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const verifier=createPrivyNodeAccessVerifier({appId:e.PRIVY_APP_ID,appSecret:e.PRIVY_APP_SECRET,appEnvironment:e.PRIVY_APP_ENVIRONMENT,testAccountLoginEnabled:e.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED});const fans=createSupabaseFanAuthRepository({url:e.SUPABASE_URL,serviceRoleKey:e.SUPABASE_SERVICE_ROLE_KEY},db);return createKakaoDisconnectHandler({authorize:(authorization)=>authorizeFanRequest({authorization,verifier,repository:fans}),repository:new SupabaseKakaoConnectionRepository(db),port:new KakaoHttpConnectionPort({clientId:e.KAKAO_CLIENT_ID??"not-configured",clientSecret:e.KAKAO_CLIENT_SECRET??"not-configured"}),redirectUri:e.KAKAO_REDIRECT_URI??`${e.NEXT_PUBLIC_APP_URL}/api/me/connected-accounts/kakao/callback`})(request);}catch{return Response.json({error:{code:"KAKAO_DISCONNECT_UNAVAILABLE"}},{status:503});}}
