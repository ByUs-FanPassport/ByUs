import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CollectibleRepositoryError,
  SupabaseCollectibleRepository,
} from "./collectible-repository";

const state = {
  eligible: false,
  claimWindow: {
    from: "2026-09-03T12:00:00.000Z",
    until: "2026-09-05T12:00:00.000Z",
  },
  claim: null,
};

describe("SupabaseCollectibleRepository", () => {
  it("uses owner-scoped RPCs and projects canonical results", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: state, error: null }) };
    const repository = new SupabaseCollectibleRepository(client);
    await expect(repository.getOwned({ appUserId: "user", liveSlug: "kara-live" })).resolves.toEqual(state);
    expect(client.rpc).toHaveBeenCalledWith("get_owned_live_collectible", {
      p_app_user_id: "user",
      p_live_slug: "kara-live",
    });
  });

  it("maps closed-window failures without leaking database errors", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "P3_COLLECTIBLE_WINDOW_EXPIRED secret sql" } }) };
    const repository = new SupabaseCollectibleRepository(client);
    await expect(repository.claimOwned({ appUserId: "user", liveSlug: "kara-live", idempotencyKey: "key" }))
      .rejects.toEqual(new CollectibleRepositoryError("CLAIM_WINDOW_EXPIRED"));
  });

  it("rejects extra top-level claim projection fields", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: { claim: {}, replayed: false, appUserId: "leak" }, error: null }) };
    const repository = new SupabaseCollectibleRepository(client);
    await expect(repository.claimOwned({ appUserId: "user", liveSlug: "kara-live", idempotencyKey: "key" }))
      .rejects.toEqual(new CollectibleRepositoryError("COLLECTIBLE_UNAVAILABLE"));
  });
});
