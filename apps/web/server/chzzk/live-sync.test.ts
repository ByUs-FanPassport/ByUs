import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { syncChzzkLive } from "./live-sync";

const liveChannel = "a".repeat(32);
const offlineChannel = "b".repeat(32);
const observedAt = "2026-09-18T00:00:00.000Z";
const celebrities = [{
  socialLinks: [
    { platform: "chzzk", url: `https://chzzk.naver.com/${liveChannel}` },
    { platform: "chzzk", url: `https://chzzk.naver.com/${offlineChannel}` },
  ],
}] as never;

describe("CHZZK LIVE sync", () => {
  it("does not replace cached offline/live state after an incomplete source scan", async () => {
    const write = vi.fn(async () => undefined);
    await expect(syncChzzkLive({
      celebrities,
      repository: { write, read: vi.fn() },
      clientId: "d0a97006-cbfa-40c4-ab11-9cade2c44ac1",
      clientSecret: "a".repeat(43),
      observe: vi.fn(async () => ({ complete: false, observations: [
        { state: "live" as const, channelId: liveChannel, observedAt, title: "공식 LIVE" },
        { state: "unavailable" as const, channelId: offlineChannel, observedAt },
      ] })),
    })).resolves.toEqual({ complete: false, live: 1, offline: 0 });
    expect(write).toHaveBeenCalledWith([
      { state: "live", channelId: liveChannel, observedAt, title: "공식 LIVE" },
    ]);
  });

  it("writes offline observations only after the complete global cursor scan", async () => {
    const write = vi.fn(async () => undefined);
    await syncChzzkLive({
      celebrities,
      repository: { write, read: vi.fn() },
      clientId: "d0a97006-cbfa-40c4-ab11-9cade2c44ac1",
      clientSecret: "a".repeat(43),
      observe: vi.fn(async () => ({ complete: true, observations: [
        { state: "live" as const, channelId: liveChannel, observedAt, title: "공식 LIVE" },
        { state: "offline" as const, channelId: offlineChannel, observedAt },
      ] })),
    });
    expect(write).toHaveBeenCalledWith([
      { state: "live", channelId: liveChannel, observedAt, title: "공식 LIVE" },
      { state: "offline", channelId: offlineChannel, observedAt },
    ]);
  });
});
