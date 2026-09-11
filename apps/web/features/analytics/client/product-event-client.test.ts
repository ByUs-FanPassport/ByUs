// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PAGE_VIEW_WINDOW_MS, pageViewIdempotencyKey } from "./product-event-client";

describe("page-view idempotency", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
      .mockReturnValueOnce("22222222-2222-4222-8222-222222222222");
  });
  afterEach(() => vi.restoreAllMocks());

  it("deduplicates within the window without persisting the anonymous session id", () => {
    const anonymousSession = "private-session-000000000001";
    window.sessionStorage.setItem("byus.product-event.session.v1", anonymousSession);
    const first = pageViewIdempotencyKey("creator_page_view", "/c/elina", 1);
    const replay = pageViewIdempotencyKey("creator_page_view", "/c/elina", PAGE_VIEW_WINDOW_MS - 1);
    const nextWindow = pageViewIdempotencyKey("creator_page_view", "/c/elina", PAGE_VIEW_WINDOW_MS);

    expect(replay).toBe(first);
    expect(nextWindow).not.toBe(first);
    expect(first).toBe("page:creator_page_view:11111111-1111-4111-8111-111111111111");
    expect(first).not.toContain(anonymousSession);
    expect(nextWindow).not.toContain(anonymousSession);
  });
});
