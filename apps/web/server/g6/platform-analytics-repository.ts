import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  analyticsWindowSchema,
  integerMetricSchema,
  metricSchema,
  type AnalyticsQuery,
  type Metric,
} from "../../features/analytics/domain/admin-analytics";

const uuid = z.uuid();
const trendPointSchema = z.object({
  date: z.string().date(),
  newFans: z.number().int().nonnegative(),
  passports: z.number().int().nonnegative(),
  reactions: z.number().int().nonnegative(),
  reservations: z.number().int().nonnegative(),
  attendances: z.number().int().nonnegative(),
  transactions: z.number().int().nonnegative(),
});
const creatorRowSchema = z.object({
  celebrityId: uuid,
  name: z.string().min(1),
  fans: z.number().int().nonnegative(),
  passports: z.number().int().nonnegative(),
  reactions: z.number().int().nonnegative(),
  reservations: z.number().int().nonnegative(),
  attendances: z.number().int().nonnegative(),
  transactions: z.number().int().nonnegative(),
});
const liveRowSchema = z.object({
  liveEventId: uuid,
  title: z.string().min(1),
  startsAt: z.iso.datetime({ offset: true }),
  reservations: z.number().int().nonnegative(),
  attendances: z.number().int().nonnegative(),
  transactions: z.number().int().nonnegative(),
});
const chainBreakdownSchema = z.object({
  passport: z.number().int().nonnegative(),
  reaction: z.number().int().nonnegative(),
  stamp: z.number().int().nonnegative(),
  collectible: z.number().int().nonnegative(),
});

export const platformAnalyticsSchema = z.object({
  window: analyticsWindowSchema,
  totals: z.object({
    fansAndWallets: integerMetricSchema,
    passports: integerMetricSchema,
    activeCreators: integerMetricSchema,
    firstReactions: integerMetricSchema,
    reservations: integerMetricSchema,
    attendances: integerMetricSchema,
    onchainActions: integerMetricSchema,
  }),
  trend: metricSchema(z.array(trendPointSchema)),
  creators: metricSchema(z.array(creatorRowSchema)),
  lives: metricSchema(z.array(liveRowSchema)),
  chain: z.object({
    total: integerMetricSchema,
    uniqueFans: integerMetricSchema,
    successful: integerMetricSchema,
    pending: integerMetricSchema,
    failed: integerMetricSchema,
    breakdown: metricSchema(chainBreakdownSchema),
  }),
});

export type PlatformAnalytics = z.infer<typeof platformAnalyticsSchema>;
export interface PlatformAnalyticsRepository {
  read(input: AnalyticsQuery & { adminAppUserId: string; adminAllowlistId: string }): Promise<PlatformAnalytics>;
}
interface RpcClient { rpc(name: string, parameters: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }> }
export class PlatformAnalyticsRepositoryError extends Error {
  constructor() { super("PLATFORM_ANALYTICS_UNAVAILABLE"); this.name = "PlatformAnalyticsRepositoryError"; }
}
export class SupabasePlatformAnalyticsRepository implements PlatformAnalyticsRepository {
  constructor(private readonly database: RpcClient) {}
  async read(input: AnalyticsQuery & { adminAppUserId: string; adminAllowlistId: string }) {
    const { data, error } = await this.database.rpc("read_admin_platform_analytics", {
      p_actor_app_user_id: input.adminAppUserId,
      p_actor_admin_allowlist_id: input.adminAllowlistId,
      p_from: input.from,
      p_to: input.to,
      p_as_of: input.asOf,
    });
    const parsed = platformAnalyticsSchema.safeParse(data);
    if (error || !parsed.success) throw new PlatformAnalyticsRepositoryError();
    return parsed.data;
  }
}
export function createPlatformAnalyticsRepository(config: { url: string; serviceRoleKey: string }): PlatformAnalyticsRepository {
  const database = createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return new SupabasePlatformAnalyticsRepository(database as unknown as RpcClient);
}

