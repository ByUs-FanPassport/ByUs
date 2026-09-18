import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { fetchChzzkLiveObservations } from "./live-source";

const clientId = "d0a97006-cbfa-40c4-ab11-9cade2c44ac1";
const clientSecret = "a".repeat(43);
const liveChannel = "0a3f97086cb81d3360c69fdf5d020045";
const offlineChannel = "b".repeat(32);
const now = () => new Date("2026-09-18T00:00:00.000Z");

function response(data: unknown[], next: string | null) {
  return new Response(JSON.stringify({ code: 200, message: null, content: { data, page: { next } } }), {
    headers: { "content-type": "application/json" },
  });
}

describe("official CHZZK LIVE source", () => {
  it("scans every cursor and marks a target offline only after a complete scan", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response([], "cursor-2"))
      .mockResolvedValueOnce(response([{ channelId: liveChannel, liveTitle: "정제니 LIVE" }], null));

    const result = await fetchChzzkLiveObservations([liveChannel, offlineChannel], {
      clientId, clientSecret, fetcher, now,
    });

    expect(result.complete).toBe(true);
    expect(result.observations).toEqual([
      { state: "live", channelId: liveChannel, observedAt: now().toISOString(), title: "정제니 LIVE" },
      { state: "offline", channelId: offlineChannel, observedAt: now().toISOString() },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1]?.[0])).toContain("next=cursor-2");
  });

  it("never reports a missing target offline when a later page fails", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response([{ channelId: liveChannel, liveTitle: "정제니 LIVE" }], "cursor-2"))
      .mockResolvedValueOnce(new Response("limited", { status: 429 }));

    const result = await fetchChzzkLiveObservations([liveChannel, offlineChannel], {
      clientId, clientSecret, fetcher, now,
    });

    expect(result.complete).toBe(false);
    expect(result.observations).toEqual([
      { state: "live", channelId: liveChannel, observedAt: now().toISOString(), title: "정제니 LIVE" },
      { state: "unavailable", channelId: offlineChannel, observedAt: now().toISOString() },
    ]);
  });
});
