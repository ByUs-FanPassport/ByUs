import "server-only";

import { authorizeAdminSession } from "../admin/admin-session-gate";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { loadServerEnv } from "../config/env";
import { createSupabaseAdminSessionRepository } from "../admin/supabase-admin-session-repository";

export function createDeploymentFingerprintDependencies() {
  const env = loadServerEnv();
  const verifier = createPrivyNodeAccessVerifier({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET });
  const repository = createSupabaseAdminSessionRepository({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
  return {
    authorize: ({ authorization, correlationId }: { authorization: string; correlationId: string }) => authorizeAdminSession({ authorization, correlationId, verifier, repository }),
    fingerprint: {
      supabaseUrl: env.SUPABASE_URL,
      vercelEnvironment: process.env.VERCEL_ENV,
      vercelTargetEnvironment: process.env.VERCEL_TARGET_ENV,
      vercelUrl: process.env.VERCEL_URL,
    },
  };
}
