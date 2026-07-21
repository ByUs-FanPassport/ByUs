import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { CanonicalPrivyIdentity, CanonicalWallet } from "../../features/auth/domain/identity";
import type { SessionSyncRepository } from "./session-sync";

export function createSupabaseSessionSyncRepository(config: { url: string; serviceRoleKey: string }): SessionSyncRepository {
  const client = createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async sync(identity: CanonicalPrivyIdentity, wallet: CanonicalWallet) {
      const { error } = await client.rpc("sync_privy_identity", {
        p_privy_user_id: identity.privyUserId,
        p_verified_email: identity.verifiedEmail,
        p_chain_id: wallet.chainId,
        p_wallet_address: wallet.address,
      });
      if (error) throw new Error("Identity synchronization failed");
    },
  };
}
