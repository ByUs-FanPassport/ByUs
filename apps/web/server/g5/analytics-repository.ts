import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const uuid = z.string().uuid();
const availableIntegerMetric = z
  .object({
    state: z.literal("available"),
    value: z.number().int().nonnegative(),
    reason: z.null(),
    source: z.string().min(1),
  })
  .passthrough();
const unavailableMetric = z
  .object({
    state: z.literal("unavailable"),
    value: z.null(),
    reason: z.string().min(1),
    source: z.null(),
  })
  .passthrough();
const suppressedMetric = z
  .object({
    state: z.literal("suppressed"),
    value: z.null(),
    reason: z.literal("SMALL_COHORT_LT_5"),
    source: z.string().min(1),
  })
  .passthrough();
const notApplicableMetric = z
  .object({
    state: z.literal("not_applicable"),
    value: z.null(),
    reason: z.string().min(1),
    source: z.string().nullable(),
  })
  .passthrough();
export const metricEnvelopeSchema = z.union([
  availableIntegerMetric,
  unavailableMetric,
  notApplicableMetric,
  suppressedMetric,
]);
const bucketValue = z.object({
  bronze: z.number().int().nonnegative(),
  silver: z.number().int().nonnegative(),
  gold: z.number().int().nonnegative(),
  platinum: z.number().int().nonnegative(),
  diamond: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
const stampValue = z.object({
  knowledge: z.number().int().nonnegative(),
  reservation: z.number().int().nonnegative(),
  attendance: z.number().int().nonnegative(),
  survey: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
const availableObjectMetric = <T extends z.ZodType>(value: T) =>
  z
    .object({
      state: z.literal("available"),
      value,
      reason: z.null(),
      source: z.string().min(1),
    })
    .passthrough();
const ratioValue = z.object({
  numerator: z.number().int().nonnegative(),
  denominator: z.number().int().positive(),
  rate: z.number().nonnegative(),
});
const ratioMetric = z.union([
  availableObjectMetric(ratioValue),
  notApplicableMetric,
]);
const privateCountMetric = z.union([availableIntegerMetric, suppressedMetric]);
const privateRatioMetric = z.union([
  availableObjectMetric(ratioValue),
  notApplicableMetric,
  suppressedMetric,
]);
const surveyAggregateValue = z.object({
  responseCount: z.number().int().min(5),
  averageRating: z.number().min(1).max(5).nullable(),
  ratingCount: z.number().int().nonnegative(),
  purchaseIntentYes: z.number().int().nonnegative(),
  purchaseIntentAnswered: z.number().int().nonnegative(),
  purchaseIntentRate: z.number().min(0).max(1).nullable(),
  futureInterestYes: z.number().int().nonnegative(),
  futureInterestAnswered: z.number().int().nonnegative(),
  futureInterestRate: z.number().min(0).max(1).nullable(),
});
const surveyAggregateMetric = z.union([
  availableObjectMetric(surveyAggregateValue),
  notApplicableMetric,
  suppressedMetric,
]);
const windowSchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  semantics: z.literal("[from,to)"),
  asOf: z.string().datetime({ offset: true }),
});

export const creatorAnalyticsSchema = z.object({
  scope: z.object({ celebrityId: uuid, liveEventId: uuid.nullable() }),
  window: windowSchema,
  metrics: z.object({
    reservationUsers: availableIntegerMetric,
    passportsIssued: availableIntegerMetric,
    levelDistribution: availableObjectMetric(bucketValue),
    stampTypeCounts: availableObjectMetric(stampValue),
    reservationCount: availableIntegerMetric,
    attendanceCount: availableIntegerMetric,
    attendanceRate: ratioMetric,
    surveyResponseCount: privateCountMetric,
    surveyCompletionRate: privateRatioMetric,
    surveyAggregates: surveyAggregateMetric,
  }),
});

export const brandAnalyticsSchema = z.object({
  scope: z.object({ brandId: uuid, liveEventId: uuid.nullable() }),
  window: windowSchema,
  funnel: z.object({
    reservationUsers: availableIntegerMetric,
    reservationCount: availableIntegerMetric,
    attendanceCount: availableIntegerMetric,
    attendanceRate: ratioMetric,
    surveyResponseCount: privateCountMetric,
    surveyCompletionRate: privateRatioMetric,
    surveyAggregates: surveyAggregateMetric,
    manualCommerce: unavailableMetric,
  }),
});

export type CreatorAnalytics = z.infer<typeof creatorAnalyticsSchema>;
export type BrandAnalytics = z.infer<typeof brandAnalyticsSchema>;
export interface AnalyticsQuery {
  liveEventId?: string;
  from: string;
  to: string;
  asOf: string;
}
export interface AnalyticsRepository {
  readCreator(
    input: AnalyticsQuery & {
      adminAppUserId: string;
      adminAllowlistId: string;
      celebrityId: string;
    },
  ): Promise<CreatorAnalytics>;
  readBrand(
    input: AnalyticsQuery & {
      adminAppUserId: string;
      adminAllowlistId: string;
      brandId: string;
    },
  ): Promise<BrandAnalytics>;
}

interface RpcClient {
  rpc(
    name: string,
    parameters: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}
export class AnalyticsRepositoryError extends Error {
  constructor() {
    super("ANALYTICS_UNAVAILABLE");
    this.name = "AnalyticsRepositoryError";
  }
}

export class SupabaseAnalyticsRepository implements AnalyticsRepository {
  constructor(private readonly database: RpcClient) {}
  private async invoke<T>(
    name: string,
    parameters: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const { data, error } = await this.database.rpc(name, parameters);
    const parsed = schema.safeParse(data);
    if (error || !parsed.success) throw new AnalyticsRepositoryError();
    return parsed.data;
  }
  readCreator(
    input: AnalyticsQuery & {
      adminAppUserId: string;
      adminAllowlistId: string;
      celebrityId: string;
    },
  ) {
    return this.invoke(
      "read_admin_creator_analytics",
      {
        p_actor_admin_allowlist_id: input.adminAllowlistId,
        p_celebrity_id: input.celebrityId,
        p_actor_app_user_id: input.adminAppUserId,
        p_live_event_id: input.liveEventId ?? null,
        p_from: input.from,
        p_to: input.to,
        p_as_of: input.asOf,
      },
      creatorAnalyticsSchema,
    );
  }
  readBrand(
    input: AnalyticsQuery & {
      adminAppUserId: string;
      adminAllowlistId: string;
      brandId: string;
    },
  ) {
    return this.invoke(
      "read_admin_brand_analytics",
      {
        p_actor_admin_allowlist_id: input.adminAllowlistId,
        p_brand_id: input.brandId,
        p_actor_app_user_id: input.adminAppUserId,
        p_live_event_id: input.liveEventId ?? null,
        p_from: input.from,
        p_to: input.to,
        p_as_of: input.asOf,
      },
      brandAnalyticsSchema,
    );
  }
}

export function createAnalyticsRepository(config: {
  url: string;
  serviceRoleKey: string;
}): AnalyticsRepository {
  const client = createClient(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return new SupabaseAnalyticsRepository(client as unknown as RpcClient);
}
