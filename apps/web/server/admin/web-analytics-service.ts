import "server-only";

import { z } from "zod";
import {
  webAnalyticsDataSchema,
  type WebAnalyticsData,
  type WebAnalyticsDays,
  type WebAnalyticsRow,
} from "../../features/analytics/domain/web-analytics";

const API_URL = "https://api.vercel.com/v1/query/web-analytics/visits/aggregate";
const DAY_MS = 86_400_000;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_LIMIT = 12;
const BREAKDOWN_LIMIT = 100;
const MAX_DAILY_WINDOW_DAYS = 60;

const metricsSchema = z.object({
  visitors: z.number().int().nonnegative(),
  pageviews: z.number().int().nonnegative(),
}).catchall(z.unknown());

const aggregateResponseSchema = z.object({
  version: z.literal(1),
  query: z.object({
    since: z.string().min(1),
    until: z.string().min(1),
    limit: z.number().int().positive(),
  }).catchall(z.unknown()),
  data: z.array(metricsSchema),
}).catchall(z.unknown());

type AggregateRow = z.infer<typeof metricsSchema>;
type Dimension = "day" | "country" | "requestPath" | "referrerHostname" | "deviceType" | "browserName" | "osName" | "environment";

export type WebAnalyticsErrorCode =
  | "WEB_ANALYTICS_NOT_CONFIGURED"
  | "WEB_ANALYTICS_PLAN_OR_ACCESS_UNAVAILABLE"
  | "WEB_ANALYTICS_RATE_LIMITED"
  | "WEB_ANALYTICS_UNAVAILABLE";

export class WebAnalyticsServiceError extends Error {
  constructor(readonly code: WebAnalyticsErrorCode) {
    super(code);
    this.name = "WebAnalyticsServiceError";
  }
}

export interface WebAnalyticsService {
  read(input: { days: WebAnalyticsDays; now: Date }): Promise<WebAnalyticsData>;
}

export interface WebAnalyticsConfig {
  token?: string;
  projectId?: string;
  teamId?: string;
}

interface CacheEntry {
  expiresAt: number;
  value: WebAnalyticsData;
}

const resultCache = new Map<string, CacheEntry>();
const transportIds = new WeakMap<Function, number>();
let nextTransportId = 1;

function transportId(transport: typeof fetch): number {
  const existing = transportIds.get(transport);
  if (existing) return existing;
  const id = nextTransportId++;
  transportIds.set(transport, id);
  return id;
}

function fingerprint(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function utcDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function rangeFor(days: WebAnalyticsDays, now: Date) {
  const currentDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const from = currentDay - (days - 1) * DAY_MS;
  const to = currentDay + DAY_MS;
  return {
    from,
    to,
    since: utcDate(from),
    until: utcDate(currentDay),
  };
}

function dailyWindows(range: ReturnType<typeof rangeFor>) {
  const windows: Array<{ since: string; until: string; limit: number }> = [];
  const lastDay = range.to - DAY_MS;
  for (let start = range.from; start <= lastDay; start += MAX_DAILY_WINDOW_DAYS * DAY_MS) {
    const end = Math.min(start + (MAX_DAILY_WINDOW_DAYS - 1) * DAY_MS, lastDay);
    windows.push({
      since: utcDate(start),
      until: utcDate(end),
      limit: Math.round((end - start) / DAY_MS) + 1,
    });
  }
  return windows;
}

function dimensionValue(row: AggregateRow, dimension: Exclude<Dimension, "day">): string {
  const value = row[dimension];
  if (typeof value !== "string") {
    throw new WebAnalyticsServiceError("WEB_ANALYTICS_UNAVAILABLE");
  }
  return value;
}

function timestampDate(row: AggregateRow): string {
  const value = row.timestamp;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new WebAnalyticsServiceError("WEB_ANALYTICS_UNAVAILABLE");
  }
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new WebAnalyticsServiceError("WEB_ANALYTICS_UNAVAILABLE");
  }
  return utcDate(timestamp);
}

function rowsFor(rows: AggregateRow[], dimension: Exclude<Dimension, "day" | "environment">): WebAnalyticsRow[] {
  return rows.map((row) => ({
    label: dimensionValue(row, dimension),
    visitors: row.visitors,
    pageviews: row.pageviews,
  }));
}

function cacheSet(key: string, value: WebAnalyticsData, expiresAt: number) {
  resultCache.delete(key);
  resultCache.set(key, { value, expiresAt });
  while (resultCache.size > CACHE_LIMIT) {
    const oldest = resultCache.keys().next().value;
    if (typeof oldest !== "string") break;
    resultCache.delete(oldest);
  }
}

export function resetWebAnalyticsCacheForTests() {
  resultCache.clear();
}

export function createWebAnalyticsService(
  config: WebAnalyticsConfig,
  options: { transport?: typeof fetch; cacheNow?: () => number; timeoutMs?: number } = {},
): WebAnalyticsService {
  const transport = options.transport ?? fetch;
  const cacheNow = options.cacheNow ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 8_000;

  return {
    async read({ days, now }) {
      const token = config.token?.trim();
      const projectId = config.projectId?.trim();
      const teamId = config.teamId?.trim();
      if (!token || !projectId) {
        throw new WebAnalyticsServiceError("WEB_ANALYTICS_NOT_CONFIGURED");
      }

      const range = rangeFor(days, now);
      const key = [transportId(transport), fingerprint(token), projectId, teamId ?? "", days, range.since, range.until].join(":");
      const cached = resultCache.get(key);
      const currentCacheTime = cacheNow();
      if (cached && cached.expiresAt > currentCacheTime) return cached.value;
      if (cached) resultCache.delete(key);

      const query = async (
        by: Dimension,
        limit: number,
        window: { since: string; until: string } = range,
      ) => {
        const url = new URL(API_URL);
        url.searchParams.set("projectId", projectId);
        if (teamId) url.searchParams.set("teamId", teamId);
        url.searchParams.set("since", `${window.since}T00:00:00.000Z`);
        url.searchParams.set("until", `${window.until}T23:59:59.999Z`);
        url.searchParams.set("by", by);
        url.searchParams.set("filter", "environment eq 'production'");
        url.searchParams.set("limit", String(limit));

        let response: Response;
        try {
          response = await transport(url, {
            headers: { authorization: `Bearer ${token}` },
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch {
          throw new WebAnalyticsServiceError("WEB_ANALYTICS_UNAVAILABLE");
        }
        if (!response.ok) {
          if (response.status === 402 || response.status === 403) {
            throw new WebAnalyticsServiceError("WEB_ANALYTICS_PLAN_OR_ACCESS_UNAVAILABLE");
          }
          if (response.status === 429) {
            throw new WebAnalyticsServiceError("WEB_ANALYTICS_RATE_LIMITED");
          }
          throw new WebAnalyticsServiceError("WEB_ANALYTICS_UNAVAILABLE");
        }
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new WebAnalyticsServiceError("WEB_ANALYTICS_UNAVAILABLE");
        }
        const parsed = aggregateResponseSchema.safeParse(body);
        if (!parsed.success) {
          throw new WebAnalyticsServiceError("WEB_ANALYTICS_UNAVAILABLE");
        }
        return parsed.data.data;
      };

      const [totalRows, trendWindows, pageRows, referrerRows, countryRows, deviceRows, browserRows, osRows] = await Promise.all([
        query("environment", 1),
        Promise.all(dailyWindows(range).map((window) => query("day", window.limit, window))),
        query("requestPath", BREAKDOWN_LIMIT),
        query("referrerHostname", BREAKDOWN_LIMIT),
        query("country", BREAKDOWN_LIMIT),
        query("deviceType", BREAKDOWN_LIMIT),
        query("browserName", BREAKDOWN_LIMIT),
        query("osName", BREAKDOWN_LIMIT),
      ]);
      const trendRows = trendWindows.flat();

      const productionTotal = totalRows.find((row) => dimensionValue(row, "environment") === "production");
      const trendByDate = new Map<string, { visitors: number; pageviews: number }>();
      for (const row of trendRows) {
        const date = timestampDate(row);
        if (date < range.since || date > range.until || trendByDate.has(date)) {
          throw new WebAnalyticsServiceError("WEB_ANALYTICS_UNAVAILABLE");
        }
        trendByDate.set(date, { visitors: row.visitors, pageviews: row.pageviews });
      }

      const data = webAnalyticsDataSchema.parse({
        days,
        from: new Date(range.from).toISOString(),
        to: new Date(range.to).toISOString(),
        fetchedAt: now.toISOString(),
        totals: productionTotal
          ? { visitors: productionTotal.visitors, pageviews: productionTotal.pageviews }
          : { visitors: 0, pageviews: 0 },
        trend: Array.from({ length: days }, (_, index) => {
          const date = utcDate(range.from + index * DAY_MS);
          return { date, ...(trendByDate.get(date) ?? { visitors: 0, pageviews: 0 }) };
        }),
        breakdowns: {
          pages: rowsFor(pageRows, "requestPath"),
          referrers: rowsFor(referrerRows, "referrerHostname"),
          countries: rowsFor(countryRows, "country"),
          devices: rowsFor(deviceRows, "deviceType"),
          browsers: rowsFor(browserRows, "browserName"),
          operatingSystems: rowsFor(osRows, "osName"),
        },
      });
      cacheSet(key, data, currentCacheTime + CACHE_TTL_MS);
      return data;
    },
  };
}

export function createWebAnalyticsServiceFromEnv(): WebAnalyticsService {
  return createWebAnalyticsService({
    token: process.env.VERCEL_ANALYTICS_TOKEN,
    projectId: process.env.VERCEL_ANALYTICS_PROJECT_ID,
    teamId: process.env.VERCEL_ANALYTICS_TEAM_ID,
  });
}
