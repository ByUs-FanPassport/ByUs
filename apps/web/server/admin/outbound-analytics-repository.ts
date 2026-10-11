import "server-only";
import { createClient } from "@supabase/supabase-js";
import { outboundAnalyticsSchema, type OutboundAnalyticsData } from "@/features/analytics/domain/outbound-analytics";
import type { WebAnalyticsDays } from "@/features/analytics/domain/web-analytics";

export interface OutboundAnalyticsRepository {
  read(input: { adminAppUserId: string; adminAllowlistId: string; days: WebAnalyticsDays }): Promise<OutboundAnalyticsData>;
}
interface RpcClient { rpc(name: string, parameters: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }

export class SupabaseOutboundAnalyticsRepository implements OutboundAnalyticsRepository {
  constructor(private readonly database: RpcClient) {}
  async read(input: Parameters<OutboundAnalyticsRepository["read"]>[0]) {
    const { data, error } = await this.database.rpc("read_admin_outbound_analytics", {
      p_actor_app_user_id: input.adminAppUserId,
      p_actor_admin_allowlist_id: input.adminAllowlistId,
      p_days: input.days,
    });
    const parsed = outboundAnalyticsSchema.safeParse(data);
    if (error || !parsed.success || parsed.data.days !== input.days) throw new Error("OUTBOUND_ANALYTICS_UNAVAILABLE");
    return parsed.data;
  }
}

export function createOutboundAnalyticsRepository(config: { url: string; serviceRoleKey: string }): OutboundAnalyticsRepository {
  const database = createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return new SupabaseOutboundAnalyticsRepository(database as unknown as RpcClient);
}
