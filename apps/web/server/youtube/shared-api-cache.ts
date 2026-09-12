import "server-only";
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { loadServerEnv } from "../config/env";

const text = z.string().max(2048);
const snippet = z.object({
  channelId: text.optional(), liveBroadcastContent: text.optional(), title: text.optional(),
  thumbnails: z.record(z.string().max(32), z.object({ url: text.optional() })).optional(),
});
const schemas = {
  channels: z.object({ items: z.array(z.object({ id: text.optional() })).max(2) }),
  search: z.object({ items: z.array(z.object({ id: z.object({ videoId: text.optional() }).optional(), snippet: z.object({ channelId: text.optional() }).optional() })).max(2), nextPageToken: text.optional() }),
  videos: z.object({ items: z.array(z.object({ id: text.optional(), snippet: snippet.optional(), status: z.object({ privacyStatus: text.optional() }).optional(), liveStreamingDetails: z.object({ actualStartTime: text.optional(), actualEndTime: text.optional() }).optional() })).max(2) }),
};
type Stage = keyof typeof schemas;
const claimSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("cached"), payload: z.unknown(), fetchedAt: z.string().datetime({ offset: true }) }),
  z.object({ state: z.literal("claimed"), leaseId: z.string().uuid(), fetchedAt: z.string().datetime({ offset: true }) }),
  z.object({ state: z.literal("unavailable") }),
]);
function cacheRequest(input: string | URL | Request): { url: URL; stage: Stage; key: string } | null {
  try {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== "https://www.googleapis.com" || url.username || url.password || url.hash) return null;
    const stage = url.pathname.replace("/youtube/v3/", "") as Stage;
    if (!Object.hasOwn(schemas, stage) || url.pathname !== `/youtube/v3/${stage}`) return null;
    const expected = stage === "channels" ? { part: "id" } : stage === "search" ? { part: "snippet", type: "video", eventType: "live", maxResults: "2" } : { part: "snippet,status,liveStreamingDetails" };
    if (Object.entries(expected).some(([key, value]) => url.searchParams.get(key) !== value)) return null;
    const identityKey = stage === "channels" ? "forHandle" : stage === "search" ? "channelId" : "id";
    const identity = url.searchParams.get(identityKey) ?? "";
    const pattern = stage === "channels" ? /^@?[\p{L}\p{N}._·-]{1,30}$/u : stage === "search" ? /^UC[A-Za-z0-9_-]{22}$/ : /^[A-Za-z0-9_-]{11}$/;
    if (!pattern.test(identity) || !url.searchParams.get("key")) return null;
    const allowed = new Set([...Object.keys(expected), identityKey, "key"]);
    if ([...url.searchParams.keys()].some((key) => !allowed.has(key) || url.searchParams.getAll(key).length !== 1)) return null;
    const canonical = new URLSearchParams(url.searchParams);
    canonical.delete("key"); canonical.sort();
    return { url, stage, key: createHash("sha256").update(`${stage}:${canonical}`).digest("hex") };
  } catch { return null; }
}
const unavailable = () => Response.json({ error: "youtube_unavailable" }, { status: 503 });
const success = (payload: unknown, fetchedAt: string) => Response.json(payload, { headers: { "x-byus-youtube-fetched-at": fetchedAt } });

export function createSharedYouTubeApiFetcher(deps: { db: Pick<SupabaseClient, "rpc">; fetcher?: typeof fetch }): typeof fetch {
  const fetcher = deps.fetcher ?? fetch;
  return async (input, init) => {
    const request = cacheRequest(input);
    if (!request || (init?.method && init.method !== "GET") || (input instanceof Request && input.method !== "GET")) return unavailable();
    const { key, stage, url } = request;
    try {
      const result = await deps.db.rpc("youtube_claim_live_api", { p_cache_key: key, p_stage: stage });
      if (result.error) return unavailable();
      const claim = claimSchema.parse(result.data);
      if (claim.state === "cached") return success(schemas[stage].parse(claim.payload), claim.fetchedAt);
      if (claim.state !== "claimed") return unavailable();
      const controller = new AbortController();
      const abort = () => controller.abort();
      init?.signal?.addEventListener("abort", abort, { once: true });
      if (init?.signal?.aborted) controller.abort();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const fetchedAt = claim.fetchedAt;
      let payload: unknown = null;
      try {
        payload = await Promise.race([
          (async () => {
            const response = await fetcher(url, { method: "GET", cache: "no-store", redirect: "error", signal: controller.signal, headers: { accept: "application/json" } });
            if (!response.ok || !response.headers.get("content-type")?.includes("json") || !response.body) throw new Error("Unavailable");
            const reader = response.body.getReader();
            const cancel = () => { void reader.cancel().catch(() => {}); };
            controller.signal.addEventListener("abort", cancel, { once: true });
            let body = "", size = 0;
            const decoder = new TextDecoder();
            try {
              while (true) {
                if (controller.signal.aborted) throw new Error("Aborted");
                const chunk = await reader.read();
                if (chunk.done) break;
                size += chunk.value.byteLength;
                if (size > 262144) { cancel(); throw new Error("Oversize"); }
                body += decoder.decode(chunk.value, { stream: true });
              }
              return schemas[stage].parse(JSON.parse(body + decoder.decode()));
            } finally { controller.signal.removeEventListener("abort", cancel); reader.releaseLock(); }
          })(),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error("Timeout")); }, 5000); }),
        ]);
      } catch { payload = null; }
      finally { clearTimeout(timeout); init?.signal?.removeEventListener("abort", abort); }
      const finished = await deps.db.rpc("youtube_finish_live_api", { p_cache_key: key, p_lease_id: claim.leaseId, p_payload: payload });
      return !finished.error && finished.data === true && payload !== null ? success(payload, fetchedAt) : unavailable();
    } catch { return unavailable(); }
  };
}
let productionFetcher: typeof fetch | undefined;
export const fetchSharedYouTubeApi: typeof fetch = async (input, init) => {
  try {
    if (!productionFetcher) {
      const env = loadServerEnv();
      const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      productionFetcher = createSharedYouTubeApiFetcher({ db });
    }
    return await productionFetcher(input, init);
  } catch { return unavailable(); }
};
