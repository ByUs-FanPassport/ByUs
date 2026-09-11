import "server-only";
import { createClient } from "@supabase/supabase-js";
import { adminOverviewSchema, type AdminOverviewData, type OverviewDays } from "../../features/analytics/domain/admin-overview";

export type OverviewInput = { adminAppUserId: string; adminAllowlistId: string; days: OverviewDays; asOf: string };
export interface AdminOverviewRepository { read(input: OverviewInput): Promise<AdminOverviewData> }
interface RpcClient { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }
export class AdminOverviewRepositoryError extends Error {
  constructor() { super("ADMIN_OVERVIEW_UNAVAILABLE"); }
}
export class SupabaseAdminOverviewRepository implements AdminOverviewRepository {
  constructor(private readonly database: RpcClient) {}
  async read(input: OverviewInput) {
    const { data, error } = await this.database.rpc("read_admin_overview", {
      p_actor_app_user_id: input.adminAppUserId,
      p_actor_admin_allowlist_id: input.adminAllowlistId,
      p_days: Number(input.days), p_as_of: input.asOf,
    });
    const parsed = adminOverviewSchema.safeParse(data);
    if (error || !parsed.success) throw new AdminOverviewRepositoryError();
    return parsed.data;
  }
}
export function createAdminOverviewRepository(config: { url: string; serviceRoleKey: string }): AdminOverviewRepository {
  return new SupabaseAdminOverviewRepository(createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) as unknown as RpcClient);
}
