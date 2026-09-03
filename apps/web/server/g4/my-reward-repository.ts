import "server-only";

import { createClient } from "@supabase/supabase-js";
import {
  parseMyRewards,
  type MyReward,
} from "../../features/benefit/domain/my-reward";

interface RpcClient {
  rpc(
    name: string,
    parameters: Record<string, string>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface MyRewardRepository {
  list(input: { appUserId: string }): Promise<MyReward[]>;
}

export class SupabaseMyRewardRepository implements MyRewardRepository {
  constructor(private readonly client: RpcClient) {}

  async list(input: { appUserId: string }): Promise<MyReward[]> {
    const { data, error } = await this.client.rpc("get_owned_benefit_rewards", {
      p_app_user_id: input.appUserId,
    });
    if (error) throw new Error("My Rewards query failed");
    try {
      return parseMyRewards(data ?? []);
    } catch {
      throw new Error("My Rewards projection is invalid");
    }
  }
}

export function createSupabaseMyRewardRepository(
  config: { url: string; serviceRoleKey: string },
  client?: RpcClient,
): MyRewardRepository {
  const database =
    client ??
    createClient(config.url, config.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  return new SupabaseMyRewardRepository(database as unknown as RpcClient);
}
