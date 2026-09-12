import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VercelTelemetry } from "./vercel-telemetry";
import { isPublicTelemetryPath, sanitizeVercelTelemetry } from "./vercel-telemetry-policy";

const navigation = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

beforeEach(() => {
  navigation.pathname = "/";
  window.history.replaceState(null, "", "/");
  delete window.va;
  delete window.vaq;
  delete window.si;
  delete window.siq;
});
afterEach(() => {
  cleanup();
  document.querySelectorAll('script[src*="/_vercel/"]').forEach((script) => script.remove());
});

describe("public Vercel telemetry boundary", () => {
  it.each(["/", "/celebrities", "/c/elina", "/c/elina/raffles/gift-1", "/c/elina/notices/hello", "/c/elina/leaderboard", "/live/calendar", "/benefits/gift", "/pages/us-fanmeetings"])("allows %s", (path) => {
    expect(isPublicTelemetryPath(path)).toBe(true);
  });
  it.each(["/admin", "/admin/fans", "/my", "/my/rewards/private/recipient", "/login", "/settings/kakao/callback", "/passports/user", "/stamps/user", "/notifications", "/onboarding/profile", "/c/elina/verify", "/c/elina/certifications/id", "/live/elina/missions", "/live/elina/survey", "/live/elina-rehearsal", "/c/test-creator", "/s/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "/unknown", "/c/elina%2Fmy"])("rejects %s", (path) => {
    expect(sanitizeVercelTelemetry({ type: "pageview", url: `https://byus.kr${path}?token=secret` })).toBeNull();
  });
  it("removes query/hash from public measurements without mutating input", () => {
    const event = { type: "vital", url: "https://byus.kr/c/elina?email=private#token", route: "/c/elina" };
    expect(sanitizeVercelTelemetry(event)).toEqual({ type: "vital", url: "https://byus.kr/c/elina", route: "/c/elina" });
    expect(event.url).toContain("email=");
  });
  it("drops measurements with a private route even if their original URL is public", () => {
    expect(sanitizeVercelTelemetry({ type: "vital", url: "https://byus.kr/", route: "/my" })).toBeNull();
  });
  it.each(["invalid", "javascript:alert(1)", "https://user:secret@byus.kr/"])("drops malformed/credential URLs: %s", (url) => {
    expect(sanitizeVercelTelemetry({ type: "pageview", url })).toBeNull();
  });
  it("drops custom business events", () => {
    expect(sanitizeVercelTelemetry({ type: "event", url: "https://byus.kr/" })).toBeNull();
  });
  it("loads neither real SDK on a private entry", () => {
    navigation.pathname = "/admin/fans";
    render(<VercelTelemetry />);
    expect(document.querySelector('script[src*="/_vercel/"]')).toBeNull();
    expect(window.vaq).toBeUndefined();
    expect(window.siq).toBeUndefined();
  });
  it("real SDKs retain privacy callbacks across public/private/public SPA navigation", () => {
    const { rerender } = render(<VercelTelemetry />);
    expect(document.querySelector('script[src="/_vercel/insights/script.js"]')).toHaveAttribute("data-disable-auto-track", "1");
    expect(document.querySelector('script[src="/_vercel/speed-insights/script.js"]')).toBeTruthy();
    const analyticsFilter = window.vaq?.find(([kind]) => kind === "beforeSend")?.[1] as typeof sanitizeVercelTelemetry;
    const speedFilter = window.siq?.find(([kind]) => kind === "beforeSend")?.[1] as typeof sanitizeVercelTelemetry;
    expect(analyticsFilter).toBeTypeOf("function");
    expect(speedFilter).toBeTypeOf("function");
    const viewsBefore = window.vaq?.filter(([kind]) => kind === "pageview").length;
    navigation.pathname = "/my";
    window.history.replaceState(null, "", "/my");
    rerender(<VercelTelemetry />);
    expect(window.vaq?.filter(([kind]) => kind === "pageview")).toHaveLength(viewsBefore!);
    expect(analyticsFilter({ type: "pageview", url: "https://byus.kr/my?account=secret" })).toBeNull();
    expect(speedFilter({ type: "vital", url: "https://byus.kr/admin/fans" })).toBeNull();
    expect(speedFilter({ type: "vital", url: "https://byus.kr/" })).toBeNull();
    navigation.pathname = "/live/elina";
    window.history.replaceState(null, "", "/live/elina");
    rerender(<VercelTelemetry />);
    expect(document.querySelectorAll('script[src*="/_vercel/"]')).toHaveLength(2);
    expect(window.vaq?.filter(([kind]) => kind === "pageview").at(-1)?.[1]).toEqual({ route: "/live/elina", path: "/live/elina" });
  });
});
