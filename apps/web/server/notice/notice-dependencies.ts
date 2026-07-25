import "server-only";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { authorizeAdminSession } from "../admin/admin-session-gate";
import { createSupabaseAdminSessionRepository } from "../admin/supabase-admin-session-repository";
import { loadServerEnv } from "../config/env";
import { createNoticeRepository } from "./notice-repository";

export function createNoticeDependencies() {
  const env = loadServerEnv();
  const verifier = createPrivyNodeAccessVerifier({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET });
  const sessions = createSupabaseAdminSessionRepository({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
  return {
    repository: createNoticeRepository({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }),
    authorize: (input: { authorization: string; correlationId: string }) =>
      authorizeAdminSession({ ...input, verifier, repository: sessions }),
  };
}
