import "server-only";
import { PrivyClient } from "@privy-io/node";
import { createClient } from "@supabase/supabase-js";
import { loadServerEnv } from "@/server/config/env";
import { AuthError } from "@/features/auth/domain/auth-errors";
import type { AccountDeletionDependencies } from "./account-deletion";
import { createPrivyNodeAccessVerifier } from "@/server/auth/privy-node-verifier";
import { authorizeFanRequest } from "@/server/fan-auth/fan-auth-gate";
import { createSupabaseFanAuthRepository } from "@/server/fan-auth/supabase-fan-auth-repository";

export function createAccountDeletionDependencies(): AccountDeletionDependencies {
  const env = loadServerEnv();
  const database = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const privy = new PrivyClient({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET });
  const verifier = createPrivyNodeAccessVerifier({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET,
    appEnvironment: env.PRIVY_APP_ENVIRONMENT, testAccountLoginEnabled: env.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED,
    appleLoginEnabled: env.PRIVY_APPLE_LOGIN_ENABLED }, privy);
  const repository = createSupabaseFanAuthRepository({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }, database);
  return {
    async verifySubject(authorization) {
      const token = /^Bearer[ \t]+([^\s]+)$/i.exec(authorization?.trim() ?? "")?.[1];
      if (!token) throw new AuthError("AUTHENTICATION_REQUIRED", 401, "Authentication is required");
      try {
        const claims = await privy.utils().auth().verifyAccessToken(token);
        if (claims.app_id !== env.PRIVY_APP_ID || typeof claims.user_id !== "string" || !claims.user_id.startsWith("did:privy:")) throw new Error("Invalid token");
        const approved = await database.rpc("has_approved_account_deletion", { p_privy_user_id: claims.user_id });
        if (approved.error) throw new Error("Deletion state unavailable");
        // Only an already accepted deletion may outlive the provider user or an
        // Apple session. First requests use the same full gate as other writes.
        if (approved.data !== true) await authorizeFanRequest({ authorization: authorization!, verifier, repository });
        return claims.user_id;
      } catch (error) {
        if (error instanceof AuthError) throw error;
        throw new AuthError("AUTHENTICATION_REQUIRED", 401, "Authentication is required");
      }
    },
    async rpc(name, args) {
      const result = await database.rpc(name, args);
      if (result.error) throw new Error("Account deletion storage unavailable");
      return result.data;
    },
    async removeObject(bucket, path) {
      const result = await database.storage.from(bucket).remove([path]);
      if (result.error) throw new Error("Object cleanup unavailable");
    },
    async deleteProviderUser(subject) {
      try { await privy.users().delete(subject); }
      catch (error) {
        if (error && typeof error === "object" && "status" in error && error.status === 404) return;
        throw new Error("Provider cleanup unavailable");
      }
    },
  };
}
