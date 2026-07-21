import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { AppUser } from "../repositories/identity-repository";
import type { FanAuthRepository } from "./fan-auth-gate";

type DatabaseClient = Pick<SupabaseClient, "from">;

export function createSupabaseFanAuthRepository(
  config: { url: string; serviceRoleKey: string },
  client?: DatabaseClient,
): FanAuthRepository {
  const database = client ?? createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return {
    async findUserByPrivyId(privyUserId): Promise<AppUser | null> {
      const { data, error } = await database
        .from("app_users")
        .select("id, privy_user_id, verified_email, status")
        .eq("privy_user_id", privyUserId)
        .maybeSingle();
      if (error) throw new Error("Fan identity lookup failed");
      if (!data) return null;
      return {
        id: data.id,
        privyUserId: data.privy_user_id,
        verifiedEmail: data.verified_email,
        status: data.status,
      };
    },
  };
}
