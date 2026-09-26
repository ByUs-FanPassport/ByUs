import "server-only";
import { z } from "zod";
import { parseYouTubeChannelUrl } from "@/features/live/domain/youtube-channel";
import type { OfficialMedia } from "@/features/media/domain/official-media";
import { fetchYouTubeApiJson } from "./youtube-live-source";

const channelId = z.string().regex(/^UC[A-Za-z0-9_-]{22}$/);
const videoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const channelPage = z.object({ items: z.array(z.object({ id: channelId, contentDetails: z.object({ relatedPlaylists: z.object({ uploads: z.string().regex(/^UU[A-Za-z0-9_-]{22}$/) }) }) })).max(1) });
const playlistPage = z.object({ items: z.array(z.object({ contentDetails: z.object({ videoId }) })).max(6) });
const videoPage = z.object({ items: z.array(z.object({ id: videoId, snippet: z.object({ channelId, title: z.string().max(500), publishedAt: z.iso.datetime({ offset: true }), liveBroadcastContent: z.enum(["none", "live", "upcoming"]) }), status: z.object({ privacyStatus: z.enum(["public", "private", "unlisted"]) }), liveStreamingDetails: z.record(z.string(), z.unknown()).optional() })).max(6) });

/** Only the published official channel is resolved; this never searches for matching names. */
export async function readYouTubeUploads(channelUrl: string, options: { apiKey?: string; fetcher?: typeof fetch } = {}): Promise<OfficialMedia[] | null> {
  const target = parseYouTubeChannelUrl(channelUrl);
  if (!target) return [];
  const apiKey = options.apiKey ?? process.env.YOUTUBE_DATA_API_KEY;
  if (!apiKey) return null;
  // Native Next data cache bounds upstream API calls without another cache service.
  const fetcher: typeof fetch = options.fetcher ?? ((input, init) => fetch(input, { ...init, cache: "force-cache", next: { revalidate: 900 } }));
  async function get(path: string, params: Record<string, string>) {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
    url.search = new URLSearchParams({ ...params, key: apiKey! }).toString();
    return (await fetchYouTubeApiJson(url, fetcher, Date.now()))?.payload;
  }
  try {
    const channels = channelPage.parse(await get("channels", { part: "contentDetails", [target.kind === "id" ? "id" : "forHandle"]: target.value }));
    const channel = channels.items[0];
    if (!channel) return [];
    if (target.kind === "id" && channel.id !== target.value) return null;
    const playlist = playlistPage.parse(await get("playlistItems", { part: "contentDetails", playlistId: channel.contentDetails.relatedPlaylists.uploads, maxResults: "6" }));
    if (!playlist.items.length) return [];
    const requested = new Set(playlist.items.map(item => item.contentDetails.videoId));
    const videos = videoPage.parse(await get("videos", { part: "snippet,status,liveStreamingDetails", id: [...requested].join(",") }));
    return videos.items.filter(item => requested.has(item.id) && item.snippet.channelId === channel.id && item.status.privacyStatus === "public" && item.snippet.liveBroadcastContent === "none" && !item.liveStreamingDetails)
      .map(item => ({ id: `youtube:${item.id}`, kind: "videos" as const, title: item.snippet.title, image: `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`, asset: null, href: `https://www.youtube.com/watch?v=${item.id}`, date: item.snippet.publishedAt }))
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  } catch { return null; }
}
