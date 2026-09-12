import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { createSharedYouTubeApiFetcher } from "./shared-api-cache";
const at = "2026-09-12T12:00:00.000Z";
const url = "https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=UCaaaaaaaaaaaaaaaaaaaaaa&type=video&eventType=live&maxResults=2&key=secret";
const leaseId = "00000000-0000-4000-8000-000000000001";
function setup(claim: unknown = { state: "claimed", leaseId, fetchedAt: at }, fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ items: [] }))) {
  const rpc = vi.fn().mockResolvedValueOnce({ data: claim, error: null }).mockResolvedValue({ data: true, error: null });
  const fetch = createSharedYouTubeApiFetcher({ db: { rpc } as unknown as Pick<SupabaseClient, "rpc">, fetcher });
  return { rpc, fetch, fetcher };
}
afterEach(() => vi.useRealTimers());
describe("shared YouTube API cache", () => {
  it("reserves before a call and stores only whitelisted fields with real fetched time", async () => {
    const { rpc, fetch, fetcher } = setup(undefined, vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ items: [], etag: "private-extra", error: "raw-secret" })));
    const result = await fetch(url);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ items: [] });
    expect(result.headers.get("x-byus-youtube-fetched-at")).toBe(at);
    expect(rpc.mock.calls[0]).toEqual(["youtube_claim_live_api", { p_cache_key: expect.stringMatching(/^[a-f0-9]{64}$/), p_stage: "search" }]);
    expect(rpc.mock.calls[1]).toEqual(["youtube_finish_live_api", { p_cache_key: expect.any(String), p_lease_id: leaseId, p_payload: { items: [] } }]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("secret");
  });
  it("does not call upstream on busy or budget exhaustion", async () => {
    const { fetch, fetcher, rpc } = setup({ state: "unavailable" });
    expect((await fetch(url)).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled(); expect(rpc).toHaveBeenCalledOnce();
  });
  it("preserves shared proof timestamps across process instances", async () => {
    const { fetch, fetcher } = setup({ state: "cached", payload: { items: [] }, fetchedAt: "2026-09-12T11:15:00+00:00" });
    expect((await fetch(url)).headers.get("x-byus-youtube-fetched-at")).toBe("2026-09-12T11:15:00+00:00");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("counts failed and malformed requests without caching raw error bodies", async () => {
    for (const response of [Response.json({ error: "secret" }, { status: 403 }), Response.json({ items: "invalid" })]) {
      const { fetch, rpc } = setup(undefined, vi.fn<typeof globalThis.fetch>().mockResolvedValue(response));
      expect((await fetch(url)).status).toBe(503);
      expect(rpc.mock.calls[1]?.[1]).toMatchObject({ p_payload: null });
    }
  });
  it("rejects stale lease completion", async () => {
    const { fetch, rpc } = setup(); rpc.mockResolvedValueOnce({ data: false, error: null });
    expect((await fetch(url)).status).toBe(503);
  });
  it("bounds a hung network, aborts, and releases through failure finish", async () => {
    vi.useFakeTimers();
    const { fetch, rpc, fetcher } = setup(undefined, vi.fn<typeof globalThis.fetch>(() => new Promise(() => {})));
    const pending = fetch(url); await vi.advanceTimersByTimeAsync(5000);
    expect((await pending).status).toBe(503);
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(rpc.mock.calls[1]?.[1]).toMatchObject({ p_payload: null });
  });
  it("rejects off-origin, arbitrary endpoints, duplicate params and broadened searches before reservation", async () => {
    const { fetch, rpc } = setup();
    for (const bad of [url.replace("www.googleapis.com", "evil.test"), url.replace("/search?", "/comments?"), url + "&maxResults=2", url.replace("eventType=live", "eventType=completed")]) expect((await fetch(bad)).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
});
