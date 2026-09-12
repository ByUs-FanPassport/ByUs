import "server-only";

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
}>;

export type YouTubeLiveObserver = (
  target: YouTubeChannelTarget,
) => Promise<YouTubeLiveObservation>;

type FetchOptions = Readonly<{
  apiKey?: string;
  fetcher?: typeof fetch;
  now?: () => Date;
}>;

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

type ApiJson = Readonly<{
  payload: Record<string, unknown>;
  fetchedAtMs: number | null;
}>;

async function fetchApiJson(
  url: URL,
  fetcher: typeof fetch,
): Promise<ApiJson | null> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error("YouTube API request timed out"));
    }, REQUEST_TIMEOUT_MS);
  });

  try {
    const request = (async (): Promise<ApiJson | null> => {
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
        fetchedAtMs: Number.isFinite(fetchedAtMs) ? fetchedAtMs : null,
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
  fetcher: typeof fetch,
): Promise<string | null> {
  if (target.kind === "id") return target.value;

  const result = await fetchApiJson(
    endpoint("channels", {
      part: "id",
      forHandle: target.value,
      key: apiKey,
    }),
    fetcher,
  );
  const items = result?.payload.items;
  if (!Array.isArray(items) || items.length !== 1) return null;
  const id = objectValue(items[0])?.id;
  return typeof id === "string" && channelIdPattern.test(id) ? id : null;
}

type SearchResult =
  | Readonly<{ state: "offline" }>
  | Readonly<{ state: "candidate"; videoId: string }>
  | Readonly<{ state: "unavailable" }>;

async function searchLiveVideo(
  channelId: string,
  apiKey: string,
  fetcher: typeof fetch,
): Promise<SearchResult> {
  const result = await fetchApiJson(
    endpoint("search", {
      part: "snippet",
      channelId,
      type: "video",
      eventType: "live",
      maxResults: "2",
      key: apiKey,
    }),
    fetcher,
  );
  const payload = result?.payload;
  if (!payload || payload.nextPageToken !== undefined) {
    return { state: "unavailable" };
  }
  const items = payload.items;
  if (!Array.isArray(items)) return { state: "unavailable" };
  if (items.length === 0) return { state: "offline" };
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
  videoId: string;
  actualStartTime: string;
  observedAtMs: number;
}>;

async function confirmLiveVideo(
  channelId: string,
  videoId: string,
  apiKey: string,
  fetcher: typeof fetch,
  observedAtMs: number,
): Promise<ConfirmedVideo | null> {
  const result = await fetchApiJson(
    endpoint("videos", {
      part: "snippet,status,liveStreamingDetails",
      id: videoId,
      key: apiKey,
    }),
    fetcher,
  );
  const items = result?.payload.items;
  if (!Array.isArray(items) || items.length !== 1) return null;

  const item = objectValue(items[0]);
  const snippet = objectValue(item?.snippet);
  const status = objectValue(item?.status);
  const liveStreamingDetails = objectValue(item?.liveStreamingDetails);
  const actualStartTime = liveStreamingDetails?.actualStartTime;
  const actualStartTimeMs =
    typeof actualStartTime === "string" ? Date.parse(actualStartTime) : Number.NaN;
  if (
    item?.id !== videoId ||
    snippet?.channelId !== channelId ||
    snippet?.liveBroadcastContent !== "live" ||
    status?.privacyStatus !== "public" ||
    typeof actualStartTime !== "string" ||
    !Number.isFinite(actualStartTimeMs) ||
    actualStartTimeMs >= observedAtMs ||
    liveStreamingDetails?.actualEndTime !== undefined
  ) {
    return null;
  }
  const evidenceTime = result?.fetchedAtMs;
  return {
    videoId,
    actualStartTime,
    observedAtMs:
      evidenceTime !== null &&
      evidenceTime !== undefined &&
      evidenceTime <= observedAtMs
        ? evidenceTime
        : observedAtMs,
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
  try {
    const channelId = await resolveChannelId(target, apiKey, fetcher);
    if (channelId === null) return unavailable();

    const searchResult = await searchLiveVideo(channelId, apiKey, fetcher);
    if (searchResult.state === "offline") {
      return { state: "offline", observedAt, channelId };
    }
    if (searchResult.state === "unavailable") return unavailable(channelId);

    const confirmed = await confirmLiveVideo(
      channelId,
      searchResult.videoId,
      apiKey,
      fetcher,
      observedAtDate.getTime(),
    );
    if (confirmed === null) return unavailable(channelId);
    return {
      state: "live",
      observedAt: new Date(confirmed.observedAtMs).toISOString(),
      channelId,
      videoId: confirmed.videoId,
      actualStartTime: confirmed.actualStartTime,
    };
  } catch {
    return unavailable();
  }
}
