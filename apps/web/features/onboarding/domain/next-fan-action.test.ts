import { describe, expect, it } from "vitest";
import type { MySummary } from "@/features/my/domain/my-summary";
import type { LiveEventResponse } from "@/features/live/domain/live-event";
import { nextFanAction, supportsFanGuide } from "./next-fan-action";

const summary = { profile: { nickname: "Fan" }, creators: [{ celebrity: { slug: "kara", name: "KARA" }, passport: { id: "11111111-1111-4111-8111-111111111111" } }] } as MySummary;
const now = new Date("2026-09-11T10:00Z");
const live = { live: { slug: "kara-live", title: "KARA LIVE", celebrity: { slug: "kara", name: "KARA" }, effectiveStatus: "scheduled", startsAt: "2026-09-12T12:00Z", reservationOpensAt: "2026-09-10T00:00Z", reservationClosesAt: "2026-09-12T00:00Z" }, viewer: { authenticated: true, passport: "active", reservation: null }, primaryAction: "reserve" } as LiveEventResponse;
const resolve = (changes: Partial<Parameters<typeof nextFanAction>[0]> = {}) => nextFanAction({ summary, lives: [live], pathname: "/", locale: "ko", now, ...changes });

describe("next fan action", () => {
  it("starts profile setup without inventing a favorite and preserves the destination", () => {
    const action = resolve({ summary: { ...summary, profile: { nickname: null }, creators: [] }, pathname: "/my", locale: "en" })!;
    const url = new URL(action.href, "https://byus.test");
    expect(action.step).toBe("profile");
    expect(url.pathname).toBe("/onboarding/profile");
    expect(url.searchParams.get("returnTo")).toBe("/my?locale=en");
    expect(url.searchParams.has("entity")).toBe(false);
  });
  it("preserves a chosen creator through profile and verification", () => {
    const action = resolve({ summary: { ...summary, profile: { nickname: null } }, pathname: "/c/kara" })!;
    const url = new URL(action.href, "https://byus.test");
    expect(url.searchParams.get("entity")).toBe("kara");
    expect(url.searchParams.get("returnTo")).toBe("/c/kara/verify?locale=ko");
  });
  it("lets fans choose their favorite, and checks ownership per creator", () => {
    expect(resolve({ summary: { ...summary, creators: [] } })).toMatchObject({ step: "verify", href: "/celebrities?locale=ko" });
    expect(resolve({ pathname: "/c/another" })).toMatchObject({ step: "verify", href: "/c/another/verify?locale=ko" });
  });
  it("offers the earliest eligible LIVE only for an owned favorite", () => {
    expect(resolve()).toMatchObject({ step: "reserve", href: "/live/kara-live?locale=ko" });
    const earlier = { ...live, live: { ...live.live, slug: "earlier", startsAt: "2026-09-11T23:00Z" } };
    expect(resolve({ lives: [live, earlier] })?.href).toContain("/live/earlier");
    expect(resolve({ lives: [{ ...live, live: { ...live.live, celebrity: { ...live.live.celebrity, slug: "other" } } }] })).toBeNull();
  });
  it("advances a scheduled reservation when its opening time arrives", () => {
    const upcoming = { ...live, primaryAction: "reservation_upcoming" as const };
    expect(resolve({ lives: [upcoming], now: new Date("2026-09-09T23:59Z") })).toBeNull();
    expect(resolve({ lives: [upcoming], now: new Date(live.live.reservationOpensAt) })).toMatchObject({ step: "reserve" });
  });
  it("never treats unavailable, reserved, unauthenticated, or closed data as actionable", () => {
    expect(resolve({ lives: undefined })).toBeNull();
    expect(resolve({ lives: [] })).toBeNull();
    expect(resolve({ lives: [{ ...live, primaryAction: "reserved" }] })).toBeNull();
    expect(resolve({ lives: [{ ...live, viewer: { ...live.viewer, authenticated: false } }] })).toBeNull();
    expect(resolve({ now: new Date(live.live.reservationClosesAt) })).toBeNull();
    expect(resolve({ lives: [{ ...live, live: { ...live.live, effectiveStatus: "live" } }] })).toBeNull();
  });
  it.each(["/login", "/onboarding/profile", "/settings", "/admin", "/c/kara/verify", "/live/kara-live", "/benefits/gift", "/passports/11111111-1111-4111-8111-111111111111/issuance"])("leaves active flows alone: %s", (path) => {
    expect(supportsFanGuide(path, "")).toBe(false);
  });
  it("excludes resumed intents and allows only safe discovery/completed pages", () => {
    expect(supportsFanGuide("/", "authIntent=active")).toBe(false);
    expect(supportsFanGuide("/c/kara", "intent=passport")).toBe(false);
    expect(supportsFanGuide("/c/kara", "locale=en")).toBe(true);
    expect(supportsFanGuide("/passports/11111111-1111-4111-8111-111111111111", "")).toBe(true);
  });
});
