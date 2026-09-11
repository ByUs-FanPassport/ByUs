import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuthError } from "../../features/auth/domain/auth-errors";
import { webAnalyticsSchema } from "../../features/analytics/domain/web-analytics";
import { createGetWebAnalyticsHandler } from "./web-analytics-route";
import {
  createWebAnalyticsService,
  resetWebAnalyticsCacheForTests,
} from "./web-analytics-service";

const admin = {
  appUserId: "11111111-1111-4111-8111-111111111111",
  allowlistId: "22222222-2222-4222-8222-222222222222",
  email: "admin@example.invalid",
  role: "admin" as const,
};
const now = new Date("2026-09-12T15:34:56.789Z");
const token = "secret-token-that-must-not-leak";

function responseFor(url: URL) {
  const by = url.searchParams.get("by");
  const since = url.searchParams.get("since") ?? "";
  const until = url.searchParams.get("until") ?? "";
  const dayRows = [
    { timestamp: "2026-09-11T00:00:00.000Z", visitors: 358, pageviews: 1386 },
  ].filter((row) => row.timestamp >= since && row.timestamp <= until);
  const dimensions: Record<string, Record<string, unknown>[]> = {
    environment: [{ environment: "production", visitors: 358, pageviews: 1386 }],
    day: dayRows,
    requestPath: [
      { requestPath: "/", visitors: 300, pageviews: 1200 },
      { requestPath: "/live", visitors: 200, pageviews: 800 },
    ],
    referrerHostname: [{ referrerHostname: "", visitors: 100, pageviews: 120 }],
    country: [{ country: "KR", visitors: 340, pageviews: 1300 }],
    deviceType: [{ deviceType: "mobile", visitors: 300, pageviews: 1000 }],
    browserName: [{ browserName: "Chrome", visitors: 250, pageviews: 900 }],
    osName: [{ osName: "iOS", visitors: 220, pageviews: 700 }],
  };
  return Response.json({
    version: 1,
    query: {
      since: url.searchParams.get("since"),
      until: url.searchParams.get("until"),
      limit: Number(url.searchParams.get("limit")),
    },
    data: dimensions[by ?? ""] ?? [],
  });
}

async function constrainedResponse(input: URL | RequestInfo) {
  const url = new URL(String(input));
  const limit = Number(url.searchParams.get("limit"));
  if (limit > 100) return Response.json({ error: { code: "bad_request" } }, { status: 400 });
  if (url.searchParams.get("by") === "day") {
    const since = Date.parse(url.searchParams.get("since") ?? "");
    const until = Date.parse(url.searchParams.get("until") ?? "");
    const inclusiveDays = Math.floor((until - since) / 86_400_000) + 1;
    if (inclusiveDays > 62) {
      return Response.json({ error: { code: "invalid_group_by" } }, { status: 400 });
    }
  }
  return responseFor(url);
}

function setup(transport = vi.fn(async (input: URL | RequestInfo, _init?: RequestInit) => constrainedResponse(input))) {
  const authorize = vi.fn(async () => admin);
  const analytics = createWebAnalyticsService(
    { token, projectId: "prj_test", teamId: "team_test" },
    { transport: transport as typeof fetch },
  );
  const handler = createGetWebAnalyticsHandler({ authorize, analytics, now: () => now });
  return { authorize, handler, transport };
}

beforeEach(() => resetWebAnalyticsCacheForTests());

describe("admin web analytics route", () => {
  it.each([
    [401, "UNAUTHENTICATED"],
    [403, "FORBIDDEN"],
  ])("returns %i before any upstream request", async (status, code) => {
    const transport = vi.fn();
    const handler = createGetWebAnalyticsHandler({
      authorize: async () => { throw new AuthError(status === 401 ? "AUTHENTICATION_REQUIRED" : "ADMIN_NOT_ALLOWLISTED", status as 401 | 403, "denied"); },
      analytics: createWebAnalyticsService(
        { token, projectId: "prj_test" },
        { transport: transport as typeof fetch },
      ),
    });

    const response = await handler(new Request("https://byus.test/api/admin/analytics/web?days=7"));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    "?days=8",
    "?days=07",
    "?days=7&days=30",
    "?days=7&projectId=attacker",
    "?token=attacker",
  ])("rejects unsupported query input: %s", async (query) => {
    const { handler, transport } = setup();
    const response = await handler(new Request(`https://byus.test/api/admin/analytics/web${query}`, {
      headers: { authorization: "Bearer admin-token" },
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "INVALID_QUERY" } });
    expect(transport).not.toHaveBeenCalled();
  });

  it("returns the inclusive UTC window, exact total query, and validated breakdowns", async () => {
    const { handler, transport } = setup();
    const response = await handler(new Request("https://byus.test/api/admin/analytics/web", {
      headers: { authorization: "Bearer admin-token" },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(webAnalyticsSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      days: 7,
      from: "2026-09-06T00:00:00.000Z",
      to: "2026-09-13T00:00:00.000Z",
      fetchedAt: now.toISOString(),
      totals: { visitors: 358, pageviews: 1386 },
    });
    expect(body.trend).toHaveLength(7);
    expect(body.trend[0]).toEqual({ date: "2026-09-06", visitors: 0, pageviews: 0 });
    expect(body.trend[5]).toEqual({ date: "2026-09-11", visitors: 358, pageviews: 1386 });
    expect(body.breakdowns.pages).toHaveLength(2);
    expect(body.breakdowns.referrers[0].label).toBe("");
    expect(body.totals).not.toEqual({ visitors: 500, pageviews: 2000 });
    expect(transport).toHaveBeenCalledTimes(8);
    for (const [input, init] of transport.mock.calls) {
      const url = new URL(String(input));
      expect(url.searchParams.get("projectId")).toBe("prj_test");
      expect(url.searchParams.get("teamId")).toBe("team_test");
      expect(url.searchParams.get("since")).toBe("2026-09-06T00:00:00.000Z");
      expect(url.searchParams.get("until")).toBe("2026-09-12T23:59:59.999Z");
      expect(url.searchParams.get("filter")).toBe("environment eq 'production'");
      expect(init).toMatchObject({
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
        redirect: "error",
      });
    }
  });

  it("rechecks admin authorization and shares cache across handler creation", async () => {
    const { authorize, handler, transport } = setup();
    const secondAuthorize = vi.fn(async () => admin);
    const secondHandler = createGetWebAnalyticsHandler({
      authorize: secondAuthorize,
      analytics: createWebAnalyticsService(
        { token, projectId: "prj_test", teamId: "team_test" },
        { transport: transport as typeof fetch },
      ),
      now: () => now,
    });
    const request = () => new Request("https://byus.test/api/admin/analytics/web?days=30", {
      headers: { authorization: "Bearer admin-token" },
    });

    expect((await handler(request())).status).toBe(200);
    expect((await secondHandler(request())).status).toBe(200);
    expect(authorize).toHaveBeenCalledOnce();
    expect(secondAuthorize).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledTimes(8);
  });

  it("splits a 90-day daily trend into bounded nonoverlapping windows", async () => {
    const { handler, transport } = setup();
    const response = await handler(new Request("https://byus.test/api/admin/analytics/web?days=90", {
      headers: { authorization: "Bearer admin-token" },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.trend).toHaveLength(90);
    expect(body.trend.at(-2)).toEqual({ date: "2026-09-11", visitors: 358, pageviews: 1386 });
    const urls = transport.mock.calls.map(([input]) => new URL(String(input)));
    const dayUrls = urls.filter((url) => url.searchParams.get("by") === "day");
    expect(dayUrls).toHaveLength(2);
    expect(dayUrls.map((url) => ({
      since: url.searchParams.get("since"),
      until: url.searchParams.get("until"),
      limit: url.searchParams.get("limit"),
    }))).toEqual([
      { since: "2026-06-15T00:00:00.000Z", until: "2026-08-13T23:59:59.999Z", limit: "60" },
      { since: "2026-08-14T00:00:00.000Z", until: "2026-09-12T23:59:59.999Z", limit: "30" },
    ]);
    for (const url of urls.filter((candidate) => candidate.searchParams.get("by") !== "day")) {
      expect(url.searchParams.get("since")).toBe("2026-06-15T00:00:00.000Z");
      expect(url.searchParams.get("until")).toBe("2026-09-12T23:59:59.999Z");
      expect(Number(url.searchParams.get("limit"))).toBeLessThanOrEqual(100);
    }
    expect(transport).toHaveBeenCalledTimes(9);
  });

  it.each([
    [402, "WEB_ANALYTICS_PLAN_OR_ACCESS_UNAVAILABLE"],
    [403, "WEB_ANALYTICS_PLAN_OR_ACCESS_UNAVAILABLE"],
    [429, "WEB_ANALYTICS_RATE_LIMITED"],
    [500, "WEB_ANALYTICS_UNAVAILABLE"],
  ])("maps upstream %i to a safe unavailable response", async (status, code) => {
    const upstreamBody = `upstream ${token}`;
    const transport = vi.fn(async () => new Response(upstreamBody, { status }));
    const { handler } = setup(transport);
    const response = await handler(new Request("https://byus.test/api/admin/analytics/web?days=7", {
      headers: { authorization: "Bearer admin-token" },
    }));
    const responseText = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(responseText)).toEqual({ error: { code } });
    expect(responseText).not.toContain(token);
    expect(responseText).not.toContain(upstreamBody);
  });

  it("fails closed when Vercel returns a malformed aggregate", async () => {
    const transport = vi.fn(async () => Response.json({ version: 1, query: {}, data: "invalid" }));
    const { handler } = setup(transport);
    const response = await handler(new Request("https://byus.test/api/admin/analytics/web?days=90", {
      headers: { authorization: "Bearer admin-token" },
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "WEB_ANALYTICS_UNAVAILABLE" } });
  });

  it("authorizes before reporting missing server configuration", async () => {
    const authorize = vi.fn(async () => admin);
    const transport = vi.fn();
    const handler = createGetWebAnalyticsHandler({
      authorize,
      analytics: createWebAnalyticsService({}, { transport: transport as typeof fetch }),
    });
    const response = await handler(new Request("https://byus.test/api/admin/analytics/web"));

    expect(authorize).toHaveBeenCalledOnce();
    expect(transport).not.toHaveBeenCalled();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "WEB_ANALYTICS_NOT_CONFIGURED" } });
  });
});
