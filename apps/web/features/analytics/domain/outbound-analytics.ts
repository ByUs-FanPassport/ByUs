import { z } from "zod";
import { outboundPropertiesSchema } from "./outbound-link";
import { webAnalyticsDaysSchema } from "./web-analytics";

const counts = z.object({ clicks: z.number().int().nonnegative(), sessions: z.number().int().nonnegative() }).strict();
export const outboundAnalyticsSchema = z.object({
  days: webAnalyticsDaysSchema,
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  totals: counts,
  rows: z.array(outboundPropertiesSchema.extend(counts.shape)).max(100),
  truncated: z.boolean(),
}).strict();
export type OutboundAnalyticsData = z.infer<typeof outboundAnalyticsSchema>;
