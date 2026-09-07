import "server-only";
import { PrivyClient } from "@privy-io/node";
import { createClient } from "@supabase/supabase-js";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { authorizeAdminSession, type AdminSession } from "../admin/admin-session-gate";
import { createSupabaseAdminSessionRepository } from "../admin/supabase-admin-session-repository";
import { loadServerEnv } from "../config/env";
import { authorizeFanRequest, type AuthorizedFan } from "../fan-auth/fan-auth-gate";
import { createSupabaseFanAuthRepository } from "../fan-auth/supabase-fan-auth-repository";
import { CertificationRepository } from "./certification-repository";

export interface CertificationDependencies {
  repository: CertificationRepository;
  authorizeFan(authorization: string | null): Promise<AuthorizedFan>;
  authorizeAdmin(authorization: string, correlationId: string): Promise<AdminSession>;
}

export function createCertificationDependencies(): CertificationDependencies {
  const env = loadServerEnv();
  const db = createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const privy = new PrivyClient({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET });
  const verifier = createPrivyNodeAccessVerifier({ appId:env.PRIVY_APP_ID,appSecret:env.PRIVY_APP_SECRET,appEnvironment:env.PRIVY_APP_ENVIRONMENT,testAccountLoginEnabled:env.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED,appleLoginEnabled:env.PRIVY_APPLE_LOGIN_ENABLED },privy);
  const fan = createSupabaseFanAuthRepository({url:env.SUPABASE_URL,serviceRoleKey:env.SUPABASE_SERVICE_ROLE_KEY},db);
  const admin = createSupabaseAdminSessionRepository({url:env.SUPABASE_URL,serviceRoleKey:env.SUPABASE_SERVICE_ROLE_KEY},db);
  return {
    repository:new CertificationRepository(db),
    authorizeFan:(authorization)=>authorizeFanRequest({authorization,verifier,repository:fan}),
    authorizeAdmin:(authorization,correlationId)=>authorizeAdminSession({authorization,correlationId,verifier,repository:admin}),
  };
}
