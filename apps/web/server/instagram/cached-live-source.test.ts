import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createInstagramLiveReader } from "./cached-live-source";

const now = () => new Date("2026-09-12T12:02:00.000Z");
const live = {
  state: "live",
  observedAt: "2026-09-12T12:01:40.326Z",
  userId: "17841400000000002",
  username: "mirrorworld.ai",
  mediaId: "18086854778246758",
  actualStartTime: "2026-09-12T12:01:14.000Z",
  permalink: "https://www.instagram.com/stories/mirrorworld.ai/3984542264785618047",
};

describe("cached Instagram LIVE reader", () => {
  it("reads only the whitelisted observation RPC and returns its strict public shape", async () => {
    const rpc = vi.fn(async () => ({ data: live, error: null }));
    const read = createInstagramLiveReader({ rpc } as never, true, now);
    await expect(read("mirrorworld-ai", "mirrorworld.ai")).resolves.toEqual(live);
    expect(rpc).toHaveBeenCalledWith("instagram_read_live_observation", {
      p_creator_slug: "mirrorworld-ai",
      p_username: "mirrorworld.ai",
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/ciphertext|access.?token|secret/i);
  });

  it("does not call storage when collection is disabled", async () => {
    const rpc = vi.fn();
    const read = createInstagramLiveReader({ rpc } as never, false, now);
    await expect(read("mirrorworld-ai", "mirrorworld.ai")).resolves.toEqual({
      state: "unavailable",
      observedAt: now().toISOString(),
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed on storage errors and strict schema failures", async () => {
    for (const response of [
      { data: null, error: { message: "private SQL detail" } },
      { data: { ...live, token_ciphertext: "secret" }, error: null },
      { data: { state: "offline", observedAt: live.observedAt, mediaId: live.mediaId }, error: null },
    ]) {
      const rpc = vi.fn(async () => response);
      const read = createInstagramLiveReader({ rpc } as never, true, now);
      await expect(read("mirrorworld-ai", "mirrorworld.ai")).resolves.toEqual({
        state: "unavailable",
        observedAt: now().toISOString(),
      });
    }
  });
});
