import "server-only";
import { tiktokPlaybackSchema, type TikTokPlayback } from "../../features/live/domain/tiktok-playback";

const TIKTOK_LIVE_ENDPOINT = "https://www.tiktok.com/api-live/user/room/";
const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 4_000;

export type TikTokLiveObservation = Readonly<
  | {
      state: "live";
      observedAt: string;
      title: string;
      thumbnailUrl: string | null;
      playback?: TikTokPlayback;
      playbackRestricted?: boolean;
    }
  | { state: "offline"; observedAt: string }
  | { state: "unavailable"; observedAt: string }
>;

export type TikTokLiveObserver = (
  handle: string,
) => Promise<TikTokLiveObservation>;

type SourceDependencies = Readonly<{
  fetchImpl?: typeof fetch;
  now?: () => Date;
}>;

const handlePattern = /^[A-Za-z0-9_](?:[A-Za-z0-9._]{0,22}[A-Za-z0-9_])$/;

export function parseCanonicalTikTokProfileUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.tiktok.com" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return null;
    }
    const match = /^\/@([^/]+)\/?$/.exec(url.pathname);
    const handle = match?.[1];
    return handle !== undefined && handlePattern.test(handle) ? handle : null;
  } catch {
    return null;
  }
}

export function isSafeTikTokThumbnailUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return false;
    }
    return [
      "tiktokcdn.com",
      "tiktokcdn-us.com",
      "byteoversea.com",
      "ibytedtos.com",
    ].some(
      (suffix) => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}

function isNumericRoomId(value: unknown): boolean {
  if (typeof value === "string") return /^[1-9]\d{0,31}$/.test(value);
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

async function readBoundedJson(response: Response): Promise<unknown | null> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (/^\d+$/.test(contentLength) === false || Number(contentLength) > MAX_RESPONSE_BYTES)
  ) {
    return null;
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
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
    reader.releaseLock();
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function playbackDetails(room: Record<string, unknown>, roomId: unknown, now: Date): {
  playback?: TikTokPlayback; playbackRestricted?: boolean;
} {
  const paid = objectValue(room.paidEvent);
  if ((typeof room.liveSubOnly === "number" && room.liveSubOnly > 0)
    || (typeof paid?.paid_type === "number" && paid.paid_type > 0)) return { playbackRestricted: true };
  // A missing/unknown access flag cannot establish that playback is public.
  if (room.liveSubOnly !== 0 || paid?.paid_type !== 0 || paid.event_id !== 0) return {};
  try {
    const pull = objectValue(objectValue(room.streamData)?.pull_data);
    const raw = stringValue(pull?.stream_data);
    if (!raw) return {};
    const streams = objectValue(objectValue(JSON.parse(raw))?.data);
    const key = stringValue(objectValue(objectValue(pull?.options)?.default_quality)?.sdk_key) ?? "hd";
    const main = objectValue(objectValue(streams?.[key])?.main);
    const url = stringValue(main?.flv);
    if (!url) return {};
    const expiry = new URL(url).searchParams.get("expire") ?? "";
    if (!/^\d{10}$/.test(expiry)) return {};
    const expiresAt = Number(expiry) * 1000;
    if (expiresAt <= now.getTime() + 5_000) return {};
    const parsed = tiktokPlaybackSchema.safeParse({ url, roomId: String(roomId), expiresAt: new Date(expiresAt).toISOString() });
    return parsed.success ? { playback: parsed.data } : {};
  } catch { return {}; }
}

export async function fetchTikTokLiveObservation(
  handle: string,
  dependencies: SourceDependencies = {},
): Promise<TikTokLiveObservation> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const finish = (
    state: TikTokLiveObservation["state"],
    details?: Readonly<{ title: string; thumbnailUrl: string | null; playback?: TikTokPlayback; playbackRestricted?: boolean }>,
  ): TikTokLiveObservation =>
    state === "live" && details
      ? { state, observedAt: now().toISOString(), ...details }
      : { state: state === "offline" ? "offline" : "unavailable", observedAt: now().toISOString() };

  if (!handlePattern.test(handle)) return finish("unavailable");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const endpoint = new URL(TIKTOK_LIVE_ENDPOINT);
    endpoint.search = new URLSearchParams({
      aid: "1988",
      uniqueId: handle,
      sourceType: "54",
    }).toString();
    const response = await fetchImpl(endpoint, {
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0",
      },
    });
    if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("json")) {
      return finish("unavailable");
    }

    const payload = objectValue(await readBoundedJson(response));
    const data = objectValue(payload?.data);
    const user = objectValue(data?.user);
    const liveRoom = objectValue(data?.liveRoom);
    if (
      payload?.statusCode !== 0 ||
      stringValue(user?.uniqueId) !== handle ||
      !liveRoom
    ) {
      return finish("unavailable");
    }

    if (liveRoom.status === 4) return finish("offline");
    if (liveRoom.status !== 2 || !isNumericRoomId(user?.roomId)) {
      return finish("unavailable");
    }

    const title = stringValue(liveRoom.title)?.trim().slice(0, 160) ?? "";
    const coverUrl = stringValue(liveRoom.coverUrl);
    return finish("live", {
      title,
      thumbnailUrl:
        coverUrl !== null && isSafeTikTokThumbnailUrl(coverUrl) ? coverUrl : null,
      ...playbackDetails(liveRoom, user?.roomId, now()),
    });
  } catch {
    return finish("unavailable");
  } finally {
    clearTimeout(timeout);
  }
}
