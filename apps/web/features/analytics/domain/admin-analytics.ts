import { z } from "zod";

export const metricStateSchema = z.enum([
  "available",
  "unavailable",
  "not_applicable",
  "suppressed",
]);

export type MetricState = z.infer<typeof metricStateSchema>;

export function metricSchema<T extends z.ZodTypeAny>(value: T) {
  return z.union([
    z.object({
      state: z.literal("available"),
      value,
      reason: z.null(),
      source: z.string().min(1),
    }).passthrough(),
    z.object({
      state: z.literal("unavailable"),
      value: z.null(),
      reason: z.string().min(1),
      source: z.null(),
    }).passthrough(),
    z.object({
      state: z.literal("not_applicable"),
      value: z.null(),
      reason: z.string().min(1),
      source: z.string().nullable(),
    }).passthrough(),
    z.object({
      state: z.literal("suppressed"),
      value: z.null(),
      reason: z.literal("SMALL_COHORT_LT_5"),
      source: z.string().min(1),
    }).passthrough(),
  ]);
}

export const integerMetricSchema = metricSchema(z.number().int().nonnegative());
export const ratioSchema = z.object({
  numerator: z.number().int().nonnegative(),
  denominator: z.number().int().positive(),
  rate: z.number().min(0).max(1),
});
export const ratioMetricSchema = metricSchema(ratioSchema);

export const analyticsWindowSchema = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  semantics: z.literal("[from,to)"),
  asOf: z.iso.datetime({ offset: true }),
  timeZone: z.literal("Asia/Seoul").default("Asia/Seoul"),
}).superRefine((window, context) => {
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);
  const asOf = Date.parse(window.asOf);
  if (from >= to) {
    context.addIssue({ code: "custom", message: "from must be before to", path: ["from"] });
  }
  if (to > asOf) {
    context.addIssue({ code: "custom", message: "to must not exceed asOf", path: ["to"] });
  }
});

export const analyticsPresetSchema = z.enum(["today", "7d", "30d", "custom"]);

export type Metric<T> = {
  state: MetricState;
  value: T | null;
  reason: string | null;
  source: string | null;
};
export type Ratio = z.infer<typeof ratioSchema>;
export type AnalyticsWindow = z.infer<typeof analyticsWindowSchema>;
export type AnalyticsPreset = z.infer<typeof analyticsPresetSchema>;
export interface AnalyticsQuery {
  from: string;
  to: string;
  asOf: string;
}
