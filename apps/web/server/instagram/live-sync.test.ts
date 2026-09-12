import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { syncInstagramLive } from "./live-sync";
import { tokenBinding } from "./service";

const celebrityId = "11111111-1111-4111-8111-111111111111";
const generation = "22222222-2222-4222-8222-222222222222";
const liveLeaseId = "33333333-3333-4333-8333-333333333333";
const identity = { id: "17841400000000001", user_id: "17841400000000002", username: "mirrorworld.ai", account_type: "MEDIA_CREATOR" as const };
const now = () => new Date("2026-09-12T12:02:00.000Z");
const connection = {
  celebrity_id: celebrityId,
  generation,
  identity,
  token_ciphertext: "sealed-token",
  token_issued_at: "2026-09-11T12:00:00.000Z",
  token_expires_at: "2026-09-13T12:00:00.000Z",
  live_lease_id: liveLeaseId,
};
const live = {
  state: "live" as const,
  observedAt: now().toISOString(),
  userId: identity.user_id,
  username: identity.username,
  mediaId: "18086854778246758",
  actualStartTime: "2026-09-12T12:01:14.000Z",
  permalink: "https://www.instagram.com/stories/mirrorworld.ai/3984542264785618047",
};

function repository(claimed = [connection], saved = true) {
  return {
    claim: vi.fn(async () => claimed),
    finish: vi.fn(async () => saved),
  };
}

describe("Instagram LIVE sync", () => {
  it("opens the claimed token with its exact Instagram identity binding", async () => {
    const repo = repository();
    const vault = { open: vi.fn(() => "private-access-token"), seal: vi.fn() };
    const observe = vi.fn(async () => live);
    await expect(syncInstagramLive({ repository: repo, vault: vault as never, graphVersion: "v25.0", observe, now }))
      .resolves.toEqual([{ celebrityId, status: "live" }]);
    expect(vault.open).toHaveBeenCalledWith(connection.token_ciphertext, tokenBinding(celebrityId, identity));
    expect(observe).toHaveBeenCalledWith(
      { userId: identity.user_id, username: identity.username },
      { accessToken: "private-access-token", graphVersion: "v25.0", now },
    );
    expect(repo.finish).toHaveBeenCalledWith(connection, live);
  });

  it("does not open or observe an expired connection and overwrites it unavailable", async () => {
    const expired = { ...connection, token_expires_at: now().toISOString() };
    const repo = repository([expired]);
    const vault = { open: vi.fn(), seal: vi.fn() };
    const observe = vi.fn(async () => live);
    await expect(syncInstagramLive({ repository: repo, vault: vault as never, graphVersion: "v25.0", observe, now }))
      .resolves.toEqual([{ celebrityId, status: "unavailable" }]);
    expect(vault.open).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
    expect(repo.finish).toHaveBeenCalledWith(expired, { state: "unavailable", observedAt: now().toISOString() });
  });

  it("persists unavailable when token opening or provider observation fails", async () => {
    for (const failure of ["vault", "provider"] as const) {
      const repo = repository();
      const vault = { open: vi.fn(() => {
        if (failure === "vault") throw new Error("ciphertext secret");
        return "private-access-token";
      }), seal: vi.fn() };
      const observe = vi.fn(async () => {
        if (failure === "provider") throw new Error("provider secret");
        return live;
      });
      await expect(syncInstagramLive({ repository: repo, vault: vault as never, graphVersion: "v25.0", observe, now }))
        .resolves.toEqual([{ celebrityId, status: "unavailable" }]);
      expect(repo.finish).toHaveBeenCalledWith(connection, { state: "unavailable", observedAt: now().toISOString() });
    }
  });

  it("reports a stale finish lease as superseded", async () => {
    const repo = repository([connection], false);
    await expect(syncInstagramLive({
      repository: repo,
      vault: { open: () => "private-access-token" } as never,
      graphVersion: "v25.0",
      observe: vi.fn(async () => live),
      now,
    })).resolves.toEqual([{ celebrityId, status: "superseded" }]);
  });

  it("runs no more than five observations concurrently", async () => {
    const claimed = Array.from({ length: 12 }, (_, index) => ({
      ...connection,
      celebrity_id: `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
    }));
    const repo = repository(claimed);
    let active = 0;
    let peak = 0;
    const observe = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active -= 1;
      return { state: "offline" as const, observedAt: now().toISOString() };
    });
    const result = await syncInstagramLive({
      repository: repo,
      vault: { open: () => "private-access-token" } as never,
      graphVersion: "v25.0",
      observe,
      now,
    });
    expect(result).toHaveLength(12);
    expect(observe).toHaveBeenCalledTimes(12);
    expect(active).toBe(0);
    expect(peak).toBe(5);
  });
});
