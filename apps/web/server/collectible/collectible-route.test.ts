import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { CollectibleRepository } from "./collectible-repository";
import { createGetCollectibleHandler, createPostCollectibleHandler } from "./collectible-route";

const appUserId = "11111111-1111-4111-8111-111111111111";
const idempotencyKey = "22222222-2222-4222-8222-222222222222";
const state = {
  eligible: false,
  claimWindow: { from: "2026-09-03T12:00:00.000Z", until: "2026-09-05T12:00:00.000Z" },
  claim: null,
};

function dependencies(repository: Partial<CollectibleRepository> = {}) {
  return {
    authorize: vi.fn().mockResolvedValue({ appUserId }),
    repository: {
      getOwned: vi.fn().mockResolvedValue(state),
      claimOwned: vi.fn().mockResolvedValue({ claim: null, replayed: false }),
      ...repository,
    } as CollectibleRepository,
  };
}

describe("owned LIVE Collectible routes", () => {
  it("GET is authenticated, owner-scoped, and private", async () => {
    const deps = dependencies();
    const response = await createGetCollectibleHandler(deps)(new Request("https://byus.test/api/live-events/kara-live/collectible", { headers: { authorization: "Bearer valid" } }), { slug: "kara-live" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(deps.repository.getOwned).toHaveBeenCalledWith({ appUserId, liveSlug: "kara-live" });
  });

  it("POST accepts only strict idempotency input", async () => {
    const deps = dependencies();
    const request = (body: unknown) => new Request("https://byus.test/api/live-events/kara-live/collectible", { method: "POST", headers: { authorization: "Bearer valid", "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await createPostCollectibleHandler(deps)(request({ idempotencyKey }), { slug: "kara-live" })).status).toBe(200);
    expect((await createPostCollectibleHandler(deps)(request({ idempotencyKey, eligible: true }), { slug: "kara-live" })).status).toBe(400);
  });
});
