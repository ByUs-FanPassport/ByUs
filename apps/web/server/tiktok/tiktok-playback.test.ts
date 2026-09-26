import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { fetchTikTokLiveObservation, type TikTokLiveObservation } from "./tiktok-live-source";
import { createGetTikTokPlayback } from "../../app/api/public/live-now/[slug]/playback/route";
import type { PublishedCelebrity } from "../content/content-domain";

const now = Date.parse("2026-09-26T13:00:00Z");
const observedAt = new Date(now).toISOString();
const url = `https://pull-f5-sg01.tiktokcdn.com/live/stream.flv?expire=${now / 1000 + 3600}&sign=test`;
const playback = { url, roomId: "7689828668055096085", expiresAt: new Date(now + 3_600_000).toISOString() };
const creator: PublishedCelebrity = { slug: "ifew", locale: "ko", name: "이퓨", summary: "", image: { url: "/ifew.jpg", alt: "", position: "center" }, roles: ["creator"], themes: [], socialLinks: [{ platform: "tiktok", url: "https://www.tiktok.com/@ifewknow" }], displayOrder: 0, fanCount: 0 };
const room = { status: 2, title: "LIVE", liveSubOnly: 0, paidEvent: { event_id: 0, paid_type: 0 },
  streamData: { pull_data: { options: { default_quality: { sdk_key: "hd" } }, stream_data: JSON.stringify({ data: { hd: { main: { flv: url } } } }) } } };
const live: TikTokLiveObservation = { state: "live", title: "LIVE", thumbnailUrl: null, observedAt, playback };
const request = new Request("http://localhost/api/public/live-now/ifew/playback?locale=ko");

async function observe(overrides: Record<string, unknown> = {}) {
  return fetchTikTokLiveObservation("ifewknow", {
    now: () => new Date(now),
    fetchImpl: vi.fn().mockResolvedValue(Response.json({ statusCode: 0, data: {
      user: { uniqueId: "ifewknow", roomId: playback.roomId }, liveRoom: { ...room, ...overrides },
    } })),
  });
}

describe("TikTok playback access and source", () => {
  it("extracts a public free LIVE FLV URL with its real expiry and room identity", async () => {
    expect(await observe()).toMatchObject({ state: "live", playback });
  });
  it("withholds playback for unknown access flags and explicitly marks restricted rooms", async () => {
    for (const fields of [{ liveSubOnly: undefined }, { liveSubOnly: "0" }, { paidEvent: null }, { paidEvent: { paid_type: 0 } }]) {
      expect(await observe(fields)).not.toHaveProperty("playback");
    }
    for (const fields of [{ liveSubOnly: 1 }, { paidEvent: { event_id: 1, paid_type: 1 } }]) {
      expect(await observe(fields)).toMatchObject({ state: "live", playbackRestricted: true });
    }
  });
  it("rejects unsafe, expired, unsigned, malformed and unsupported stream sources", async () => {
    for (const bad of [url.replace("https:", "http:"), url.replace("tiktokcdn.com", "tiktokcdn.com.evil.test"), url.replace("sign=test", "other=test"), url.replace(String(now / 1000 + 3600), String(now / 1000)), url.replace(".flv", ".mpd")]) {
      expect(await observe({ streamData: { pull_data: { stream_data: JSON.stringify({ data: { hd: { main: { flv: bad } } } }) } } })).not.toHaveProperty("playback");
    }
    expect(await observe({ streamData: { pull_data: { stream_data: "broken" } } })).not.toHaveProperty("playback");
  });
  it("resolves only a published creator's handle and performs a fresh lookup on each request", async () => {
    const findBySlug = vi.fn().mockResolvedValue(creator);
    const source = vi.fn().mockResolvedValueOnce({ ...live, playback: { ...playback, expiresAt: observedAt } }).mockResolvedValue(live);
    const get = createGetTikTokPlayback({ repository: { findBySlug }, observe: source, now: () => now });
    expect((await get(request, "ifew")).status).toBe(503);
    const response = await get(request, "ifew");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...playback, observedAt });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(source).toHaveBeenCalledTimes(2);
    expect(source).toHaveBeenLastCalledWith("ifewknow");
    expect(findBySlug).toHaveBeenCalledWith("ko", "ifew");
    findBySlug.mockResolvedValue(null);
    expect((await get(request, "ifew")).status).toBe(404);
    expect((await get(request, "https://evil.test")).status).toBe(400);
    expect(source).toHaveBeenCalledTimes(2);
  });
  it("returns explicit ended/restricted and refuses unavailable or old observations", async () => {
    for (const [observation, status] of [
      [{ state: "offline", observedAt }, 410], [{ ...live, playbackRestricted: true }, 403],
      [{ state: "unavailable", observedAt }, 503], [{ ...live, observedAt: new Date(now - 60_001).toISOString() }, 503],
    ] as const) {
      const get = createGetTikTokPlayback({ repository: { findBySlug: vi.fn().mockResolvedValue(creator) }, observe: vi.fn().mockResolvedValue(observation), now: () => now });
      expect((await get(request, "ifew")).status).toBe(status);
    }
  });
  it("uses the first valid TikTok profile when an earlier link is not canonical", async () => {
    const source = vi.fn().mockResolvedValue(live);
    const get = createGetTikTokPlayback({
      repository: { findBySlug: vi.fn().mockResolvedValue({ ...creator, socialLinks: [
        { platform: "tiktok", url: "https://www.tiktok.com/" }, ...creator.socialLinks,
      ] }) }, observe: source, now: () => now,
    });
    expect((await get(request, "ifew")).status).toBe(200);
    expect(source).toHaveBeenCalledWith("ifewknow");
  });
});
