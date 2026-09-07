import "server-only";
import { createClient } from "@supabase/supabase-js";
import { loadServerEnv } from "../config/env";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { authorizeAdminSession } from "../admin/admin-session-gate";
import { createSupabaseAdminSessionRepository } from "../admin/supabase-admin-session-repository";
import { loadInstagramConfig } from "./config";
import { tokenVault } from "./crypto";
import { createInstagramProvider } from "./provider";
import { createInstagramRepository, readInstagramMedia } from "./repository";
import { createInstagramService } from "./service";

export function createInstagramDependencies(options: { allowDisabled?: boolean } = {}) {
  const config = loadInstagramConfig(process.env, options.allowDisabled);
  const env = loadServerEnv();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const repository = createInstagramRepository(db);
  const provider = createInstagramProvider(config);
  const vault = tokenVault(config.encryptionKey);
  const service = createInstagramService({ repository, provider, vault });
  return {
    config, repository, provider, service,
    async authorize(request: Request) {
      const verifier = createPrivyNodeAccessVerifier({
        appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET, appEnvironment: env.PRIVY_APP_ENVIRONMENT,
        testAccountLoginEnabled: env.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED, appleLoginEnabled: env.PRIVY_APPLE_LOGIN_ENABLED,
      });
      return authorizeAdminSession({
        authorization: request.headers.get("authorization") ?? "", correlationId: crypto.randomUUID(), verifier,
        repository: createSupabaseAdminSessionRepository({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }, db),
      });
    },
    readMedia: (slug: string) => readInstagramMedia(db, slug),
  };
}
