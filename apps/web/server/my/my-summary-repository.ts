import "server-only";

import { createClient } from "@supabase/supabase-js";
import { mySummarySchema, type MySummary } from "../../features/my/domain/my-summary";

interface RpcClient {
  rpc(name: string, parameters: Record<string, string>): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface MySummaryRepository {
  get(input: { appUserId: string; locale: "ko" | "en"; asOf: Date }): Promise<MySummary>;
}

export class SupabaseMySummaryRepository implements MySummaryRepository {
  constructor(private readonly client: RpcClient) {}
  async get(input: { appUserId: string; locale: "ko" | "en"; asOf: Date }): Promise<MySummary> {
    const { data, error } = await this.client.rpc("get_owned_my_fan_activity", {
      p_app_user_id: input.appUserId,
      p_locale: input.locale,
      p_as_of: input.asOf.toISOString(),
    });
    if (error) throw new Error("MY summary query failed");
    try { return mySummarySchema.parse(data); }
    catch { throw new Error("MY summary projection is invalid"); }
  }
}

export function createSupabaseMySummaryRepository(config: { url: string; serviceRoleKey: string }, client?: RpcClient): MySummaryRepository {
  const database = client ?? createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return new SupabaseMySummaryRepository(database as unknown as RpcClient);
}
