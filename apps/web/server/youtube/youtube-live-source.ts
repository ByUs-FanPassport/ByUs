import "server-only";
import { YOUTUBE_LIVE_MAX_AGE_MS } from "../../features/live/domain/youtube-channel";

const YOUTUBE_API_ORIGIN = "https://www.googleapis.com";
const YOUTUBE_API_PATH = "/youtube/v3";
const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
const FETCHED_AT_HEADER = "x-byus-youtube-fetched-at";

export type YouTubeChannelTarget = Readonly<{
  kind: "id" | "handle";
  value: string;
}>;

export type YouTubeLiveObservation = Readonly<{
  state: "live" | "offline" | "unavailable";
  observedAt: string;
  channelId?: string;
  videoId?: string;
  actualStartTime?: string;
  title?: string;
  thumbnailUrl?: string;
}>;

export type YouTubeLiveObserver = (
  target: YouTubeChannelTarget,
) => Promise<YouTubeLiveObservation>;

type FetchOptions = Readonly<{
  apiKey?: string;
  fetcher?: typeof fetch;
  now?: () => Date;
  apiFetcher?: YouTubeApiFetcher;
  freshApiFetcher?: YouTubeApiFetcher;
}>;

export type YouTubeApiStage = "channels" | "search" | "videos";
export type YouTubeApiJson = Readonly<{
  payload: Record<string, unknown>;
  fetchedAtMs: number;
}>;
export type YouTubeApiFetcher = (
  stage: YouTubeApiStage,
  url: URL,
) => Promise<YouTubeApiJson | null>;

const channelIdPattern = /^UC[A-Za-z0-9_-]{22}$/;
const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const handlePattern = /^@?[\p{L}\p{N}._·-]{1,30}$/u;

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function readBoundedJson(
  response: Response,
  signal: AbortSignal,
): Promise<unknown | null> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (/^\d+$/.test(contentLength) === false ||
      Number(contentLength) > MAX_RESPONSE_BYTES)
  ) {
    return null;
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const cancelReader = () => {
    void reader.cancel();
  };
  signal.addEventListener("abort", cancelReader, { once: true });
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  } finally {
    signal.removeEventListener("abort", cancelReader);
    reader.releaseLock();
  }
}

function endpoint(path: "channels" | "search" | "videos", params: Record<string, string>): URL {
  const url = new URL(`${YOUTUBE_API_PATH}/${path}`, YOUTUBE_API_ORIGIN);
  url.search = new URLSearchParams(params).toString();
  return url;
}

export async function fetchYouTubeApiJson(
  url: URL,
  fetcher: typeof fetch,
  fallbackFetchedAtMs: number,
): Promise<YouTubeApiJson | null> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error("YouTube API request timed out"));
    }, REQUEST_TIMEOUT_MS);
  });

  try {
    const request = (async (): Promise<YouTubeApiJson | null> => {
      const response = await fetcher(url, {
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (
        !response.ok ||
        !response.headers.get("content-type")?.toLowerCase().includes("json")
      ) {
        return null;
      }
      const payload = objectValue(await readBoundedJson(response, controller.signal));
      if (payload === null) return null;
      const fetchedAtHeader = response.headers.get(FETCHED_AT_HEADER);
      const fetchedAtMs =
        fetchedAtHeader === null ? Number.NaN : Date.parse(fetchedAtHeader);
      return {
        payload,
        fetchedAtMs: Number.isFinite(fetchedAtMs) ? fetchedAtMs : fallbackFetchedAtMs,
      };
    })();
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function validTarget(target: YouTubeChannelTarget): boolean {
  return target.kind === "id"
    ? channelIdPattern.test(target.value)
    : handlePattern.test(target.value);
}

async function resolveChannelId(
  target: YouTubeChannelTarget,
  apiKey: string,
  apiFetcher: YouTubeApiFetcher,
): Promise<string | null> {
  if (target.kind === "id") return target.value;

  const result = await apiFetcher(
    "channels",
    endpoint("channels", {
      part: "id",
      forHandle: target.value,
      key: apiKey,
    }),
  );
  const items = result?.payload.items;
  if (!Array.isArray(items) || items.length !== 1) return null;
  const id = objectValue(items[0])?.id;
  return typeof id === "string" && channelIdPattern.test(id) ? id : null;
}

type SearchResult =
  | Readonly<{ state: "offline"; observedAtMs: number }>
  | Readonly<{ state: "candidate"; videoId: string }>
  | Readonly<{ state: "unavailable" }>;

async function searchLiveVideo(
  channelId: string,
  apiKey: string,
  apiFetcher: YouTubeApiFetcher,
): Promise<SearchResult> {
  const result = await apiFetcher(
    "search",
    endpoint("search", {
      part: "snippet",
      channelId,
      type: "video",
      eventType: "live",
      maxResults: "2",
      key: apiKey,
    }),
  );
  const payload = result?.payload;
  if (!payload || payload.nextPageToken !== undefined) {
    return { state: "unavailable" };
  }
  const items = payload.items;
  if (!Array.isArray(items)) return { state: "unavailable" };
  if (items.length === 0) return { state: "offline", observedAtMs: result.fetchedAtMs };
  if (items.length !== 1) return { state: "unavailable" };

  const item = objectValue(items[0]);
  const id = objectValue(item?.id);
  const snippet = objectValue(item?.snippet);
  const videoId = id?.videoId;
  if (
    typeof videoId !== "string" ||
    !videoIdPattern.test(videoId) ||
    snippet?.channelId !== channelId
  ) {
    return { state: "unavailable" };
  }
  return { state: "candidate", videoId };
}

type ConfirmedVideo = Readonly<{
  state: "live";
  videoId: string;
  actualStartTime: string;
  observedAtMs: number;
  title?: string;
  thumbnailUrl?: string;
}>;

type VideoConfirmation = ConfirmedVideo | Readonly<{ state: "offline"; observedAtMs: number }> |
  Readonly<{ state: "unavailable" }>;

function safeThumbnail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.href === value && url.protocol === "https:" && !url.username && !url.password && !url.port &&
      (url.hostname === "ytimg.com" || url.hostname.endsWith(".ytimg.com")) ? value : undefined;
  } catch {
    return undefined;
  }
}

function thumbnailFromSnippet(snippet: Record<string, unknown>): string | undefined {
  const thumbnails = objectValue(snippet.thumbnails);
  if (!thumbnails) return undefined;
  for (const name of ["maxres", "standard", "high", "medium", "default"]) {
    const url = safeThumbnail(objectValue(thumbnails[name])?.url);
    if (url) return url;
  }
  return undefined;
}

async function confirmLiveVideo(
  channelId: string,
  videoId: string,
  apiKey: string,
  apiFetcher: YouTubeApiFetcher,
  freshApiFetcher: YouTubeApiFetcher | undefined,
  observedAtMs: number,
): Promise<VideoConfirmation> {
  const url = endpoint("videos", {
      part: "snippet,status,liveStreamingDetails",
      id: videoId,
      key: apiKey,
    });
  let result = await apiFetcher("videos", url);
  if (result && freshApiFetcher && observedAtMs - result.fetchedAtMs >= YOUTUBE_LIVE_MAX_AGE_MS) {
    result = await freshApiFetcher("videos", url);
  }
  if (result && observedAtMs - result.fetchedAtMs >= YOUTUBE_LIVE_MAX_AGE_MS) {
    return { state: "unavailable" };
  }
  const items = result?.payload.items;
  if (!result || !Array.isArray(items) || items.length !== 1) return { state: "unavailable" };

  const item = objectValue(items[0]);
  const snippet = objectValue(item?.snippet);
  const status = objectValue(item?.status);
  const liveStreamingDetails = objectValue(item?.liveStreamingDetails);
  if (!item || !snippet || !status || item.id !== videoId || snippet.channelId !== channelId ||
      typeof snippet.liveBroadcastContent !== "string" || typeof status.privacyStatus !== "string") {
    return { state: "unavailable" };
  }
  if (!["live", "none", "upcoming"].includes(snippet.liveBroadcastContent) ||
      !["public", "private", "unlisted"].includes(status.privacyStatus)) {
    return { state: "unavailable" };
  }
  const actualEndTime = liveStreamingDetails?.actualEndTime;
  const actualEndTimeMs = typeof actualEndTime === "string" ? Date.parse(actualEndTime) : Number.NaN;
  if (snippet.liveBroadcastContent !== "live" || status.privacyStatus !== "public" ||
      (typeof actualEndTime === "string" && Number.isFinite(actualEndTimeMs))) {
    return { state: "offline", observedAtMs: result.fetchedAtMs };
  }
  const actualStartTime = liveStreamingDetails?.actualStartTime;
  const actualStartTimeMs =
    typeof actualStartTime === "string" ? Date.parse(actualStartTime) : Number.NaN;
  if (
    typeof actualStartTime !== "string" ||
    !Number.isFinite(actualStartTimeMs) ||
    actualStartTimeMs >= result.fetchedAtMs ||
    liveStreamingDetails?.actualEndTime !== undefined
  ) {
    return { state: "unavailable" };
  }
  const title = typeof snippet.title === "string" ? snippet.title.trim().slice(0, 160) : "";
  const thumbnailUrl = thumbnailFromSnippet(snippet);
  return {
    state: "live",
    videoId,
    actualStartTime,
    observedAtMs: result.fetchedAtMs,
    ...(title ? { title } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
  };
}

export async function fetchYouTubeLiveObservation(
  target: YouTubeChannelTarget,
  options: FetchOptions = {},
): Promise<YouTubeLiveObservation> {
  const now = options.now ?? (() => new Date());
  const observedAtDate = now();
  const observedAt = observedAtDate.toISOString();
  const unavailable = (channelId?: string): YouTubeLiveObservation => ({
    state: "unavailable",
    observedAt,
    ...(channelId === undefined ? {} : { channelId }),
  });
  const apiKey = options.apiKey ?? process.env.YOUTUBE_DATA_API_KEY;
  if (!validTarget(target) || typeof apiKey !== "string" || apiKey.trim() === "") {
    return unavailable();
  }

  const fetcher = options.fetcher ?? fetch;
  const directApiFetcher: YouTubeApiFetcher = (stage, url) => {
    void stage;
    return fetchYouTubeApiJson(url, fetcher, now().getTime());
  };
  const apiFetcher = options.apiFetcher ?? directApiFetcher;
  try {
    const channelId = await resolveChannelId(target, apiKey, apiFetcher);
    if (channelId === null) return unavailable();

    const searchResult = await searchLiveVideo(channelId, apiKey, apiFetcher);
    if (searchResult.state === "offline") {
      return { state: "offline", observedAt: new Date(searchResult.observedAtMs).toISOString(), channelId };
    }
    if (searchResult.state === "unavailable") return unavailable(channelId);

    const confirmed = await confirmLiveVideo(
      channelId,
      searchResult.videoId,
      apiKey,
      apiFetcher,
      options.freshApiFetcher,
      observedAtDate.getTime(),
    );
    if (confirmed.state === "unavailable") return unavailable(channelId);
    if (confirmed.state === "offline") return { state: "offline", observedAt: new Date(confirmed.observedAtMs).toISOString(), channelId };
    return {
      state: "live",
      observedAt: new Date(confirmed.observedAtMs).toISOString(),
      channelId,
      videoId: confirmed.videoId,
      actualStartTime: confirmed.actualStartTime,
      ...(confirmed.title ? { title: confirmed.title } : {}),
      ...(confirmed.thumbnailUrl ? { thumbnailUrl: confirmed.thumbnailUrl } : {}),
    };
  } catch {
    return unavailable();
  }
}
