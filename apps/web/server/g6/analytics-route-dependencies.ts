import "server-only";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { authorizeAdminSession } from "../admin/admin-session-gate";
import { createSupabaseAdminSessionRepository } from "../admin/supabase-admin-session-repository";
import { loadServerEnv } from "../config/env";
import { createPlatformAnalyticsRepository } from "./platform-analytics-repository";
import { createLiveAnalyticsRepository } from "./live-analytics-repository";

export function createG6AnalyticsRouteDependencies() {
  const environment=loadServerEnv();
  const verifier=createPrivyNodeAccessVerifier({appId:environment.PRIVY_APP_ID,appSecret:environment.PRIVY_APP_SECRET, appEnvironment: environment.PRIVY_APP_ENVIRONMENT, testAccountLoginEnabled: environment.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED, appleLoginEnabled: environment.PRIVY_APPLE_LOGIN_ENABLED});
  const adminRepository=createSupabaseAdminSessionRepository({url:environment.SUPABASE_URL,serviceRoleKey:environment.SUPABASE_SERVICE_ROLE_KEY});
  const authorize=({authorization,correlationId}:{authorization:string;correlationId:string})=>authorizeAdminSession({authorization,correlationId,verifier,repository:adminRepository});
  return {authorize,platformRepository:createPlatformAnalyticsRepository({url:environment.SUPABASE_URL,serviceRoleKey:environment.SUPABASE_SERVICE_ROLE_KEY}),liveRepository:createLiveAnalyticsRepository({url:environment.SUPABASE_URL,serviceRoleKey:environment.SUPABASE_SERVICE_ROLE_KEY})};
}
