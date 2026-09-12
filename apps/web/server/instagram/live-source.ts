import "server-only";

import {
  instagramLiveObservationSchema,
  parseInstagramLivePermalink,
  type InstagramLiveObservation,
} from "@/features/live/domain/instagram-live";

export type InstagramLiveTarget = Readonly<{ userId: string; username: string }>;
export type { InstagramLiveObservation } from "@/features/live/domain/instagram-live";

type Options = Readonly<{
  accessToken: string;
  graphVersion: string;
  fetcher?: typeof fetch;
  now?: () => Date;
}>;
const idPattern = /^\d{1,30}$/;
const usernamePattern = /^[A-Za-z0-9._]{1,30}$/;
const MAX_BYTES = 64 * 1024;

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new Error("INVALID_RESPONSE");
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      if (signal.aborted) throw new Error("TIMEOUT");
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error("INVALID_RESPONSE"); }
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

/** Private worker/service only. Never wire token retrieval to anonymous watch requests. */
export async function fetchInstagramLiveObservation(target: InstagramLiveTarget, options: Options): Promise<InstagramLiveObservation> {
  const now = options.now ?? (() => new Date());
  const observedAt = now().toISOString();
  const unavailable = instagramLiveObservationSchema.parse({ state: "unavailable", observedAt });
  if (!idPattern.test(target.userId) || !usernamePattern.test(target.username) ||
      !/^v\d+\.0$/.test(options.graphVersion) || !/^[A-Za-z0-9_.-]{20,}$/.test(options.accessToken)) return unavailable;
  const username = target.username.toLowerCase();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("TIMEOUT")); }, 5000);
  });
  try {
    const request = async (): Promise<InstagramLiveObservation> => {
      const url = new URL(`https://graph.instagram.com/${options.graphVersion}/${target.userId}/live_media`);
      url.search = new URLSearchParams({ fields: "id,media_type,media_product_type,permalink,timestamp,username", limit: "2" }).toString();
      const response = await (options.fetcher ?? fetch)(url.toString(), {
        headers: { authorization: `Bearer ${options.accessToken}` }, signal: controller.signal,
        redirect: "error", cache: "no-store",
      });
      if (!response.ok) { void response.body?.cancel().catch(() => undefined); return unavailable; }
      const body = object(await boundedJson(response, controller.signal));
      if (!body || Object.keys(body).some((key) => !["data"].includes(key)) || !Array.isArray(body.data)) return unavailable;
      if (body.data.length === 0) return { state: "offline", observedAt };
      if (body.data.length !== 1) return unavailable;
      const row = object(body.data[0]);
      if (!row || Object.keys(row).some((key) => !["id", "media_type", "media_product_type", "permalink", "timestamp", "username"].includes(key)) ||
          Object.keys(row).length !== 6 || typeof row.id !== "string" || !idPattern.test(row.id) ||
          typeof row.username !== "string" || row.username.toLowerCase() !== username ||
          row.media_type !== "BROADCAST" || row.media_product_type !== "FEED") return unavailable;
      const permalink = typeof row.permalink === "string" ? parseInstagramLivePermalink(row.permalink, username) : null;
      const timestamp = typeof row.timestamp === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(row.timestamp)
        ? Date.parse(row.timestamp) : NaN;
      if (!permalink || !Number.isFinite(timestamp) || timestamp > Date.parse(observedAt)) return unavailable;
      return instagramLiveObservationSchema.parse({ state: "live", observedAt, userId: target.userId, username, mediaId: row.id,
        actualStartTime: new Date(timestamp).toISOString(), permalink });
    };
    return await Promise.race([request(), timeout]);
  } catch { return unavailable; }
  finally { clearTimeout(timer); }
}
