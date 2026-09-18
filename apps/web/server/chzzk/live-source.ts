import "server-only";

import { z } from "zod";

import {
  chzzkChannelIdSchema,
  chzzkLiveObservationSchema,
  type ChzzkLiveObservation,
} from "@/features/live/domain/chzzk-live";

const LIVE_ENDPOINT = "https://openapi.chzzk.naver.com/open/v1/lives";
const MAX_PAGES = 150;
const MAX_RESPONSE_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const SCAN_TIMEOUT_MS = 45_000;

const pageSchema = z.object({
  code: z.literal(200), message: z.string().nullable(),
  content: z.object({
    data: z.array(z.object({
      channelId: chzzkChannelIdSchema,
      liveTitle: z.string().max(2_000).optional(),
    }).passthrough()).max(20),
    page: z.object({ next: z.string().nullable() }),
  }),
});

type SourceOptions = Readonly<{
  clientId: string;
  clientSecret: string;
  fetcher?: typeof fetch;
  now?: () => Date;
}>;

export type ChzzkLiveScan = Readonly<{
  complete: boolean;
  observations: ChzzkLiveObservation[];
}>;

async function readBoundedJson(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) throw new Error("CHZZK response too large");
  if (!response.body) throw new Error("CHZZK response missing body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error("CHZZK response too large"); }
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}

function safeCredentials(options: SourceOptions): boolean {
  return z.string().uuid().safeParse(options.clientId).success && /^[A-Za-z0-9_-]{32,200}$/.test(options.clientSecret);
}

async function fetchPage(next: string | null, options: SourceOptions, timeoutMs: number): Promise<z.infer<typeof pageSchema>> {
  const url = new URL(LIVE_ENDPOINT);
  url.searchParams.set("size", "20");
  if (next) url.searchParams.set("next", next);
  const response = await (options.fetcher ?? fetch)(url, {
    headers: { "Client-Id": options.clientId, "Client-Secret": options.clientSecret, "Content-Type": "application/json" },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, timeoutMs)),
  });
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("json")) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error("CHZZK LIVE unavailable");
  }
  return pageSchema.parse(await readBoundedJson(response));
}

/** Reads the official global LIVE list. Only a complete cursor traversal may prove a target offline. */
export async function fetchChzzkLiveObservations(channelIds: readonly string[], options: SourceOptions): Promise<ChzzkLiveScan> {
  const targets = [...new Set(channelIds.filter((value) => chzzkChannelIdSchema.safeParse(value).success))];
  const observedAt = (options.now ?? (() => new Date()))().toISOString();
  const unavailable = (): ChzzkLiveScan => ({ complete: false, observations: targets.map((channelId) => chzzkLiveObservationSchema.parse({ state: "unavailable", channelId, observedAt })) });
  if (!targets.length) return { complete: true, observations: [] };
  if (!safeCredentials(options)) return unavailable();

  const targetSet = new Set(targets);
  const liveTitles = new Map<string, string>();
  const seenCursors = new Set<string>();
  const deadline = Date.now() + SCAN_TIMEOUT_MS;
  let next: string | null = null;
  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      const result = await fetchPage(next, options, remainingMs);
      for (const row of result.content.data) {
        if (!targetSet.has(row.channelId) || liveTitles.has(row.channelId)) continue;
        const title = row.liveTitle?.trim().slice(0, 160) || "CHZZK LIVE";
        liveTitles.set(row.channelId, title);
      }
      next = result.content.page.next;
      if (next === null) {
        return {
          complete: true,
          observations: targets.map((channelId) => chzzkLiveObservationSchema.parse(liveTitles.has(channelId)
            ? { state: "live", channelId, observedAt, title: liveTitles.get(channelId)! }
            : { state: "offline", channelId, observedAt })),
        };
      }
      if (seenCursors.has(next)) break;
      seenCursors.add(next);
    }
  } catch { /* Preserve fresh prior storage for every target not positively observed live. */ }
  return {
    complete: false,
    observations: targets.map((channelId) => chzzkLiveObservationSchema.parse(liveTitles.has(channelId)
      ? { state: "live", channelId, observedAt, title: liveTitles.get(channelId)! }
      : { state: "unavailable", channelId, observedAt })),
  };
}
