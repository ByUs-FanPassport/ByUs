import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuthError } from "../../features/auth/domain/auth-errors";
import type { JourneyRepository } from "./journey-repository";
import { JourneyRepositoryError } from "./journey-repository";
import {
  createGetJourneyHandler,
  createPostJourneyHandler,
  type JourneyRouteDependencies,
} from "./journey-route";

const appUserId = "11111111-1111-4111-8111-111111111111";
const idempotencyKey = "22222222-2222-4222-8222-222222222222";
const journey = {
  liveEventId: "33333333-3333-4333-8333-333333333333",
  requirementRevisionId: "44444444-4444-4444-8444-444444444444",
  eligible: false,
  complete: false,
  requirements: {
    passport: { required: true, state: "complete" as const },
    reservation: { required: false, state: "incomplete" as const },
    attendance: { required: true, state: "incomplete" as const },
    missions: [],
  },
  bonusTicketAmount: 3,
  completedAt: null,
  ticketLedgerId: null,
};

function dependencies(
  repository: Partial<JourneyRepository> = {},
): JourneyRouteDependencies {
  return {
    authorize: vi.fn().mockResolvedValue({ appUserId }),
    repository: {
      getOwned: vi.fn().mockResolvedValue(journey),
      evaluateOwned: vi.fn().mockResolvedValue(journey),
      ...repository,
    },
  };
}

function post(body: unknown, authorization = "Bearer valid") {
  return new Request("https://byus.test/api/live-events/kara-live/journey", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("owned LIVE Journey routes", () => {
  it("GET reads the canonical authenticated owner and remains private", async () => {
    const deps = dependencies();
    const response = await createGetJourneyHandler(deps)(
      new Request("https://byus.test/api/live-events/kara-live/journey", {
        headers: { authorization: "Bearer valid" },
      }),
      { slug: "kara-live" },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(journey);
    expect(deps.repository.getOwned).toHaveBeenCalledWith({
      appUserId,
      liveSlug: "kara-live",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Authorization");
  });

  it("POST accepts only a strict UUID body and never trusts owner or event facts", async () => {
    const deps = dependencies();
    const response = await createPostJourneyHandler(deps)(
      post({ idempotencyKey }),
      { slug: "kara-live" },
    );
    expect(response.status).toBe(200);
    expect(deps.repository.evaluateOwned).toHaveBeenCalledWith({
      appUserId,
      liveSlug: "kara-live",
      idempotencyKey,
    });

    for (const invalid of [
      { idempotencyKey, appUserId: "attacker" },
      { idempotencyKey, complete: true },
      { idempotencyKey, productEvent: "journey_completed" },
      { idempotencyKey: "not-a-uuid" },
      {},
    ]) {
      expect(
        (await createPostJourneyHandler(deps)(post(invalid), { slug: "kara-live" }))
          .status,
      ).toBe(400);
    }
  });

  it("rejects malformed slug/content-type before repository access", async () => {
    const deps = dependencies();
    const malformedSlug = await createPostJourneyHandler(deps)(
      post({ idempotencyKey }),
      { slug: "../admin" },
    );
    const wrongType = await createPostJourneyHandler(deps)(
      new Request("https://byus.test/api/live-events/kara-live/journey", {
        method: "POST",
        headers: { authorization: "Bearer valid", "content-type": "text/plain" },
        body: JSON.stringify({ idempotencyKey }),
      }),
      { slug: "kara-live" },
    );
    expect(malformedSlug.status).toBe(400);
    expect(wrongType.status).toBe(400);
    expect(deps.repository.evaluateOwned).not.toHaveBeenCalled();
  });

  it("authenticates before parsing and rejects loose or oversized JSON media", async () => {
    const unauthorized = dependencies();
    unauthorized.authorize = vi.fn().mockRejectedValue(
      new AuthError("AUTHENTICATION_REQUIRED", 401, "secret auth detail"),
    );
    const invalidBody = new Request("https://byus.test/api/live-events/kara-live/journey", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    expect(
      (await createPostJourneyHandler(unauthorized)(invalidBody, { slug: "kara-live" })).status,
    ).toBe(401);

    const authorized = dependencies();
    for (const contentType of ["application/jsonp", "application/json-evil"]) {
      const response = await createPostJourneyHandler(authorized)(
        new Request("https://byus.test/api/live-events/kara-live/journey", {
          method: "POST",
          headers: { authorization: "Bearer valid", "content-type": contentType },
          body: JSON.stringify({ idempotencyKey }),
        }),
        { slug: "kara-live" },
      );
      expect(response.status).toBe(400);
    }

    const oversized = await createPostJourneyHandler(authorized)(
      new Request("https://byus.test/api/live-events/kara-live/journey", {
        method: "POST",
        headers: {
          authorization: "Bearer valid",
          "content-type": "application/json; charset=utf-8",
          "content-length": "5000",
        },
        body: JSON.stringify({ idempotencyKey }),
      }),
      { slug: "kara-live" },
    );
    expect(oversized.status).toBe(400);
    expect(authorized.repository.evaluateOwned).not.toHaveBeenCalled();
  });

  it("requires authentication for both reads and evaluation", async () => {
    const deps = dependencies();
    deps.authorize = vi.fn().mockRejectedValue(
      new AuthError("AUTHENTICATION_REQUIRED", 401, "secret auth detail"),
    );
    const getResponse = await createGetJourneyHandler(deps)(
      new Request("https://byus.test/api/live-events/kara-live/journey"),
      { slug: "kara-live" },
    );
    const postResponse = await createPostJourneyHandler(deps)(
      post({ idempotencyKey }, ""),
      { slug: "kara-live" },
    );
    expect(getResponse.status).toBe(401);
    expect(postResponse.status).toBe(401);
    expect(await getResponse.json()).toEqual({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
    expect(deps.repository.getOwned).not.toHaveBeenCalled();
    expect(deps.repository.evaluateOwned).not.toHaveBeenCalled();
  });

  it("maps absent, conflicting replay, and opaque availability failures", async () => {
    const cases = [
      ["JOURNEY_NOT_FOUND", 404],
      ["IDEMPOTENCY_CONFLICT", 409],
      ["JOURNEY_UNAVAILABLE", 503],
    ] as const;
    for (const [code, status] of cases) {
      const deps = dependencies({
        evaluateOwned: vi.fn().mockRejectedValue(new JourneyRepositoryError(code)),
      });
      const response = await createPostJourneyHandler(deps)(
        post({ idempotencyKey }),
        { slug: "kara-live" },
      );
      expect(response.status).toBe(status);
      expect(JSON.stringify(await response.json())).not.toMatch(/sql|relation|secret/i);
    }
  });
});
