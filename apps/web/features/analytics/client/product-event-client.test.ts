// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PAGE_VIEW_WINDOW_MS,
  pageViewIdempotencyKey,
  recordClientProductEvent,
} from "./product-event-client";

describe("page-view idempotency", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
      .mockReturnValueOnce("22222222-2222-4222-8222-222222222222")
      .mockReturnValueOnce("33333333-3333-4333-8333-333333333333")
      .mockReturnValueOnce("44444444-4444-4444-8444-444444444444");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 201 })));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("deduplicates one owner and route within the window without persisting owner ids", async () => {
    const anonymousSession = "private-session-000000000001";
    window.sessionStorage.setItem("byus.product-event.session.v1", anonymousSession);
    const first = await pageViewIdempotencyKey("creator_page_view", "/c/elina", null, 1);
    const replay = await pageViewIdempotencyKey("creator_page_view", "/c/elina", null, PAGE_VIEW_WINDOW_MS - 1);
    const nextWindow = await pageViewIdempotencyKey("creator_page_view", "/c/elina", null, PAGE_VIEW_WINDOW_MS);

    expect(replay).toBe(first);
    expect(nextWindow).not.toBe(first);
    expect(first).toBe("page:creator_page_view:11111111-1111-4111-8111-111111111111");
    expect(first).not.toContain(anonymousSession);
    expect(nextWindow).not.toContain(anonymousSession);
    const pageViewStorage = Object.entries(window.sessionStorage)
      .filter(([key]) => key !== "byus.product-event.session.v1");
    expect(JSON.stringify(pageViewStorage)).not.toContain(anonymousSession);
  });

  it("replays the complete first page-view payload when remount input drifts", async () => {
    window.sessionStorage.setItem("byus.product-event.session.v1", "private-session-000000000001");
    const key = await pageViewIdempotencyKey("benefit_page_view", "/benefits/benefit-1", null, 1);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-12T00:00:00.000Z"));
    await recordClientProductEvent({
      eventName: "benefit_page_view",
      celebrityId: null,
      liveEventId: null,
      missionId: null,
      benefitId: "22222222-2222-4222-8222-222222222222",
      source: "fan.benefit.detail",
      idempotencyKey: key,
      properties: { presentation: "page" },
    });
    vi.setSystemTime(new Date("2026-09-12T00:01:00.000Z"));
    await recordClientProductEvent({
      eventName: "benefit_page_view",
      celebrityId: null,
      liveEventId: null,
      missionId: null,
      benefitId: "33333333-3333-4333-8333-333333333333",
      source: "fan.benefit.detail",
      idempotencyKey: key,
      properties: { presentation: "modal" },
    });

    const requests = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[1]).toMatchObject({
      occurredAt: "2026-09-12T00:00:00.000Z",
      benefitId: "22222222-2222-4222-8222-222222222222",
      properties: { presentation: "page" },
    });
  });

  it("uses separate opaque keys across anonymous, login, and account boundaries", async () => {
    const ownerA = "did:privy:owner-a-private";
    const ownerB = "did:privy:owner-b-private";
    window.sessionStorage.setItem("byus.product-event.session.v1", "private-session-000000000001");

    const anonymous = await pageViewIdempotencyKey("live_page_view", "/live/one", null, 1);
    const authenticatedA = await pageViewIdempotencyKey("live_page_view", "/live/one", ownerA, 1);
    const replayA = await pageViewIdempotencyKey("live_page_view", "/live/one", ownerA, 2);
    const authenticatedB = await pageViewIdempotencyKey("live_page_view", "/live/one", ownerB, 2);

    await recordClientProductEvent({
      eventName: "live_page_view",
      celebrityId: null,
      liveEventId: "22222222-2222-4222-8222-222222222222",
      missionId: null,
      benefitId: null,
      source: "fan.live.detail",
      idempotencyKey: anonymous,
      properties: { provider: "chzzk" },
    });
    await recordClientProductEvent({
      eventName: "live_page_view",
      celebrityId: null,
      liveEventId: "22222222-2222-4222-8222-222222222222",
      missionId: null,
      benefitId: null,
      source: "fan.live.detail",
      idempotencyKey: authenticatedA,
      properties: { provider: "chzzk" },
    }, "token-owner-a-first");
    await recordClientProductEvent({
      eventName: "live_page_view",
      celebrityId: null,
      liveEventId: "22222222-2222-4222-8222-222222222222",
      missionId: null,
      benefitId: null,
      source: "fan.live.detail",
      idempotencyKey: authenticatedB,
      properties: { provider: "chzzk" },
    }, "token-owner-b");

    expect(new Set([anonymous, authenticatedA, authenticatedB]).size).toBe(3);
    expect(replayA).toBe(authenticatedA);
    const requests = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(requests.map((request) => request.idempotencyKey)).toEqual([
      anonymous,
      authenticatedA,
      authenticatedB,
    ]);
    expect(requests.map((request) => request.anonymousSessionId)).toEqual([
      "private-session-000000000001",
      null,
      null,
    ]);
    const stored = JSON.stringify(window.sessionStorage);
    expect(stored).not.toContain(ownerA);
    expect(stored).not.toContain(ownerB);
    expect(stored).not.toContain("token-owner-a-first");
    expect(stored).not.toContain("token-owner-b");
  });

  it("reuses the canonical payload when one owner's bearer token rotates", async () => {
    const key = await pageViewIdempotencyKey("creator_page_view", "/c/elina", "did:privy:owner-a", 1);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-12T00:00:00.000Z"));
    const input = {
      eventName: "creator_page_view" as const,
      celebrityId: null,
      liveEventId: null,
      missionId: null,
      benefitId: null,
      source: "fan.creator.detail",
      idempotencyKey: key,
      properties: { celebritySlug: "elina" },
    };
    await recordClientProductEvent(input, "rotated-token-one");
    vi.setSystemTime(new Date("2026-09-12T00:01:00.000Z"));
    await recordClientProductEvent({ ...input, properties: { celebritySlug: "changed" } }, "rotated-token-two");

    const requests = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(requests[1]).toEqual(requests[0]);
    const stored = JSON.stringify(window.sessionStorage);
    expect(stored).not.toContain("rotated-token-one");
    expect(stored).not.toContain("rotated-token-two");
  });

  it("rotates a retained route key when its canonical payload entry is gone", async () => {
    const first = await pageViewIdempotencyKey("creator_page_view", "/c/elina", null, 1);
    await recordClientProductEvent({
      eventName: "creator_page_view",
      celebrityId: null,
      liveEventId: null,
      missionId: null,
      benefitId: null,
      source: "fan.creator.detail",
      idempotencyKey: first,
      properties: { celebritySlug: "elina" },
    });
    window.sessionStorage.removeItem("byus.product-event.page-view-cache.v2");

    const afterEviction = await pageViewIdempotencyKey("creator_page_view", "/c/elina", null, 2);

    expect(afterEviction).not.toBe(first);
  });

  it("bounds page-view key and canonical payload storage", async () => {
    window.sessionStorage.setItem("byus.product-event.session.v1", "private-session-000000000001");
    let uuid = 0;
    vi.mocked(crypto.randomUUID).mockImplementation(() => {
      uuid += 1;
      return `${String(uuid).padStart(8, "0")}-0000-4000-8000-000000000000`;
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-12T00:00:00.000Z"));

    for (let index = 0; index < 65; index += 1) {
      const key = await pageViewIdempotencyKey("creator_page_view", `/c/creator-${index}`, null, Date.now());
      await recordClientProductEvent({
        eventName: "creator_page_view",
        celebrityId: null,
        liveEventId: null,
        missionId: null,
        benefitId: null,
        source: "fan.creator.detail",
        idempotencyKey: key,
        properties: { celebritySlug: `creator-${index}` },
      });
    }

    const entries = JSON.parse(window.sessionStorage.getItem("byus.product-event.page-view-cache.v2") ?? "[]") as unknown[];
    expect(entries).toHaveLength(64);
  });
});
