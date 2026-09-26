import { expect, it, vi } from "vitest";
import { readYouTubeUploads } from "./youtube-uploads";
vi.mock("server-only", () => ({}));
const channel = `UC${"a".repeat(22)}`, playlist = `UU${"a".repeat(22)}`;
const video = (id: string, privacyStatus = "public", liveBroadcastContent = "none", channelId = channel) => ({ id, snippet: { channelId, title: `Video ${id}`, publishedAt: "2026-09-27T00:00:00Z", liveBroadcastContent }, status: { privacyStatus } });
function api(videos: Array<ReturnType<typeof video> & { liveStreamingDetails?: Record<string, string> }> = [video("abcdefghijk")]) {
  return vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ items: [{ id: channel, contentDetails: { relatedPlaylists: { uploads: playlist } } }] }))
    .mockResolvedValueOnce(Response.json({ items: videos.map(item => ({ contentDetails: { videoId: item.id } })) }))
    .mockResolvedValueOnce(Response.json({ items: videos }));
}
it("resolves the published channel identity and returns only its public recorded uploads", async () => {
  const fetcher = api([video("abcdefghijk"), video("private____", "private"), video("live_______", "public", "live"), video("other______", "public", "none", `UC${"b".repeat(22)}`), { ...video("ended______"), liveStreamingDetails: { actualStartTime: "2026-09-01T00:00:00Z", actualEndTime: "2026-09-01T01:00:00Z" } }]);
  const items = await readYouTubeUploads("https://www.youtube.com/@ElinaKarimova", { apiKey: "key", fetcher });
  expect(items).toEqual([expect.objectContaining({ href: "https://www.youtube.com/watch?v=abcdefghijk", image: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg", kind: "videos" })]);
  const urls = fetcher.mock.calls.map(([input]) => new URL(String(input)));
  expect(urls.map(url => url.pathname)).toEqual(["/youtube/v3/channels", "/youtube/v3/playlistItems", "/youtube/v3/videos"]);
  expect(urls[0].searchParams.get("forHandle")).toBe("elinakarimova");
  expect(urls[1].searchParams.get("playlistId")).toBe(playlist);
});
it("rejects arbitrary hosts without sending a key and distinguishes quota failure from no uploads", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: 403 } }, { status: 403 }));
  expect(await readYouTubeUploads("https://attacker.invalid/@artist", { apiKey: "key", fetcher })).toEqual([]);
  expect(fetcher).not.toHaveBeenCalled();
  expect(await readYouTubeUploads(`https://youtube.com/channel/${channel}`, { apiKey: "key", fetcher })).toBeNull();
  const empty = api([]);
  expect(await readYouTubeUploads(`https://youtube.com/channel/${channel}`, { apiKey: "key", fetcher: empty })).toEqual([]);
  expect(empty).toHaveBeenCalledTimes(2);
});
it("does not accept mismatched explicit channels or malformed upstream video data", async () => {
  const wrong = api();
  expect(await readYouTubeUploads(`https://youtube.com/channel/UC${"b".repeat(22)}`, { apiKey: "key", fetcher: wrong })).toBeNull();
  expect(wrong).toHaveBeenCalledTimes(1);
  const malformed = api([{ ...video("abcdefghijk"), snippet: { ...video("abcdefghijk").snippet, publishedAt: "not-a-date" } }]);
  expect(await readYouTubeUploads(`https://youtube.com/channel/${channel}`, { apiKey: "key", fetcher: malformed })).toBeNull();
});
