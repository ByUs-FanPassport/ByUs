import { z } from "zod";

export const webAnalyticsDaysSchema = z.union([
  z.literal(7),
  z.literal(30),
  z.literal(90),
]);

export const webAnalyticsRowSchema = z.object({
  label: z.string(),
  visitors: z.number().int().nonnegative(),
  pageviews: z.number().int().nonnegative(),
}).strict();

const webAnalyticsTrendRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  visitors: z.number().int().nonnegative(),
  pageviews: z.number().int().nonnegative(),
}).strict();

export const webAnalyticsSchema = z.object({
  days: webAnalyticsDaysSchema,
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  fetchedAt: z.iso.datetime({ offset: true }),
  totals: z.object({
    visitors: z.number().int().nonnegative(),
    pageviews: z.number().int().nonnegative(),
  }).strict(),
  trend: z.array(webAnalyticsTrendRowSchema),
  breakdowns: z.object({
    pages: z.array(webAnalyticsRowSchema),
    referrers: z.array(webAnalyticsRowSchema),
    countries: z.array(webAnalyticsRowSchema),
    devices: z.array(webAnalyticsRowSchema),
    browsers: z.array(webAnalyticsRowSchema),
    operatingSystems: z.array(webAnalyticsRowSchema),
  }).strict(),
}).strict();

export type WebAnalyticsDays = z.infer<typeof webAnalyticsDaysSchema>;
export type WebAnalyticsRow = z.infer<typeof webAnalyticsRowSchema>;
export const webAnalyticsDataSchema = webAnalyticsSchema;
export type WebAnalyticsData = z.infer<typeof webAnalyticsSchema>;
