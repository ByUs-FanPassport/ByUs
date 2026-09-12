import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { fetchInstagramLiveObservation } from "./live-source";

const now = () => new Date("2026-09-12T12:01:40.326Z");
const target = { userId: "17841400000000000", username: "mirrorworld.ai" };
const token = "fake_test_token_not_a_real_secret";
const row = { id: "18086854778246758", username: "mirrorworld.ai", media_type: "BROADCAST", media_product_type: "FEED",
  permalink: "https://www.instagram.com/stories/mirrorworld.ai/3984542264785618047", timestamp: "2026-09-12T12:01:14+0000" };
function fetcher(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}
const options = (transport: typeof fetch) => ({ accessToken: token, graphVersion: "v25.0", fetcher: transport, now });
afterEach(() => vi.useRealTimers());

describe("private Instagram LIVE source", () => {
  it("recognizes the captured official BROADCAST/FEED response and returns only the public live shape", async () => {
    const transport = fetcher({ data: [row] });
    const result = await fetchInstagramLiveObservation(target, options(transport));
    expect(result).toEqual({ state: "live", userId: target.userId, username: target.username, mediaId: row.id,
      observedAt: now().toISOString(), actualStartTime: "2026-09-12T12:01:14.000Z", permalink: row.permalink });
    const [url, init] = vi.mocked(transport).mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/graph.instagram.com\/v25.0\/17841400000000000\/live_media\?/);
    expect(String(url)).not.toContain(token);
    expect(init).toMatchObject({ headers: { authorization: `Bearer ${token}` }, redirect: "error", cache: "no-store" });
    expect(JSON.stringify(result)).not.toContain(token);
  });
  it("returns offline only for a successful empty list", async () => {
    await expect(fetchInstagramLiveObservation(target, options(fetcher({ data: [] })))).resolves.toMatchObject({ state: "offline" });
    for (const body of [{}, { data: null }, { data: [], error: { code: 190 } }, { data: [], paging: {} }, { data: [], paging: { next: "private" } }]) {
      await expect(fetchInstagramLiveObservation(target, options(fetcher(body)))).resolves.toMatchObject({ state: "unavailable" });
    }
    await expect(fetchInstagramLiveObservation(target, options(fetcher({ data: [] }, 403)))).resolves.toMatchObject({ state: "unavailable" });
  });
  it.each([
    { username: "someone.else" }, { media_product_type: "LIVE" }, { media_type: "VIDEO" },
    { timestamp: undefined }, { timestamp: "2026-09-12T13:00:00Z" }, { timestamp: "2026-09-12T12:01:14" },
    { id: 789 }, { permalink: "https://www.instagram.com/stories/other.owner/3984542264785618047" },
    { permalink: "https://www.instagram.com/p/3984542264785618047/" },
    { permalink: "https://www.instagram.com/reel/3984542264785618047/" },
    { permalink: "https://www.instagram.com.evil.test/stories/mirrorworld.ai/3984542264785618047" },
    { permalink: "https://www.instagram.com/stories/mirrorworld.ai/3984542264785618047?access_token=hidden" },
    { permalink: "https://user:pass@www.instagram.com/stories/mirrorworld.ai/3984542264785618047" },
    { permalink: "https://www.instagram.com/stories/mirrorworld.ai//3984542264785618047" },
  ])("rejects mismatched, incomplete or unsafe candidate %j", async (override) => {
    await expect(fetchInstagramLiveObservation(target, options(fetcher({ data: [{ ...row, ...override }] })))).resolves.toMatchObject({ state: "unavailable" });
  });
  it("rejects multiple candidates, pagination and excessive response bodies", async () => {
    for (const body of [{ data: [row, row] }, { data: [row], paging: { next: "next" } },
      { data: [{ ...row, access_token: token }] }, { data: [row], padding: "x".repeat(65536) }]) {
      await expect(fetchInstagramLiveObservation(target, options(fetcher(body)))).resolves.toMatchObject({ state: "unavailable" });
    }
  });
  it("makes no request with a masked credential, malformed target or version", async () => {
    const transport = fetcher({ data: [] });
    await fetchInstagramLiveObservation(target, { ...options(transport), accessToken: `IGAA${"•".repeat(40)}` });
    await fetchInstagramLiveObservation({ ...target, userId: "../me" }, options(transport));
    await fetchInstagramLiveObservation(target, { ...options(transport), graphVersion: "v25.0/../" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("bounds a stalled response body and cancels its reader", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const transport = vi.fn(async () => new Response(new ReadableStream({ cancel }))) as unknown as typeof fetch;
    const result = fetchInstagramLiveObservation(target, options(transport));
    await vi.advanceTimersByTimeAsync(5001);
    await expect(result).resolves.toMatchObject({ state: "unavailable" });
    expect(cancel).toHaveBeenCalled();
  });
});
