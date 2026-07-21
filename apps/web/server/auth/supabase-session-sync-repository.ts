import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { CanonicalPrivyIdentity, CanonicalWallet } from "../../features/auth/domain/identity";
import { fanProfileSchema } from "../../features/profile/domain/profile";
import type { SessionSyncRepository } from "./session-sync";

interface SessionSyncRpcClient {
  rpc(name: string, parameters: Record<string, string | number>): PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>;
}

export class SupabaseSessionSyncRepository implements SessionSyncRepository {
  constructor(private readonly client: SessionSyncRpcClient) {}

  async sync(identity: CanonicalPrivyIdentity, wallet: CanonicalWallet) {
    const { data, error } = await this.client.rpc("sync_privy_identity", {
      p_privy_user_id: identity.privyUserId,
      p_verified_email: identity.verifiedEmail,
      p_chain_id: wallet.chainId,
      p_wallet_address: wallet.address,
    });
    if (error) throw new Error("Identity synchronization failed");
    const row = Array.isArray(data) ? data[0] : null;
    if (!row || typeof row !== "object" || !("app_user_id" in row) || typeof row.app_user_id !== "string") {
      throw new Error("Identity synchronization returned an invalid owner");
    }
    const profileResult = await this.client.rpc("get_owned_user_profile", { p_app_user_id: row.app_user_id });
    if (profileResult.error) throw new Error("Profile state lookup failed");
    const profile = fanProfileSchema.safeParse(profileResult.data);
    if (!profile.success) throw new Error("Profile state lookup returned invalid data");
    return profile.data;
  }
}

export function createSupabaseSessionSyncRepository(config: { url: string; serviceRoleKey: string }): SessionSyncRepository {
  const client = createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return new SupabaseSessionSyncRepository(client as unknown as SessionSyncRpcClient);
}
