import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuthError } from "../../features/auth/domain/auth-errors";
import { createGetLiveCalendarHandler } from "./live-calendar-route";

const guestPayload = {
  month: "2026-09",
  timeZone: "Asia/Seoul" as const,
  days: [{ date: "2026-09-01", events: [] }],
};

function target(options: { authorizationError?: Error; result?: typeof guestPayload } = {}) {
  const readMonth = vi.fn().mockResolvedValue(options.result ?? guestPayload);
  return {
    readMonth,
    run: createGetLiveCalendarHandler({
      repository: { readMonth },
      authorize: async () => {
        if (options.authorizationError) throw options.authorizationError;
        return { appUserId: "owner-1" };
      },
      now: () => new Date("2026-09-03T00:00:00.000Z"),
    }),
  };
}

describe("GET LIVE calendar handler", () => {
  it("serves a guest month with public caching and an explicit auth cache boundary", async () => {
    const value = target();
    const response = await value.run(new Request("https://byus.example/api/live-events/calendar?month=2026-09&locale=ko"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(guestPayload);
    expect(value.readMonth).toHaveBeenCalledWith({ month: "2026-09", locale: "ko", appUserId: null, now: new Date("2026-09-03T00:00:00.000Z") });
    expect(response.headers.get("cache-control")).toContain("s-maxage=60");
    expect(response.headers.get("vercel-cache-tag")).toBe("byus-public-content");
    expect(response.headers.get("vary")).toContain("Authorization");
  });

  it("uses the authenticated session owner and never a query-supplied identity", async () => {
    const value = target();
    const response = await value.run(new Request("https://byus.example/api/live-events/calendar?month=2026-09&locale=en", { headers: { authorization: "Bearer valid" } }));

    expect(response.status).toBe(200);
    expect(value.readMonth).toHaveBeenCalledWith(expect.objectContaining({ appUserId: "owner-1", locale: "en" }));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Authorization");

    const injected = target();
    const invalid = await injected.run(new Request("https://byus.example/api/live-events/calendar?month=2026-09&appUserId=attacker"));
    expect(invalid.status).toBe(400);
    expect(injected.readMonth).not.toHaveBeenCalled();
  });

  it.each([
    ["2026-9", "ko"],
    ["2026-13", "ko"],
    ["2026-09", "ko-KR"],
  ])("rejects invalid month %s or locale %s before reading", async (month, locale) => {
    const value = target();
    const response = await value.run(new Request(`https://byus.example/api/live-events/calendar?month=${month}&locale=${locale}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "INVALID_CALENDAR_REQUEST" } });
    expect(value.readMonth).not.toHaveBeenCalled();
  });

  it("rejects an invalid supplied session instead of silently downgrading it", async () => {
    const value = target({ authorizationError: new AuthError("AUTHENTICATION_REQUIRED", 401, "invalid") });
    const response = await value.run(new Request("https://byus.example/api/live-events/calendar?month=2026-09", { headers: { authorization: "Bearer bad" } }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "AUTHENTICATION_REQUIRED" } });
    expect(value.readMonth).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("redacts repository failures behind a stable availability response", async () => {
    const run = createGetLiveCalendarHandler({
      repository: { readMonth: async () => { throw new Error("database secret"); } },
      authorize: async () => ({ appUserId: "owner" }),
      now: () => new Date(),
    });
    const response = await run(new Request("https://byus.example/api/live-events/calendar?month=2026-09"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "LIVE_CALENDAR_UNAVAILABLE" } });
  });
});
