import { createHash } from "node:crypto";
import { z } from "zod";
import { CHZZK_CHANNEL_ID, chzzkPostSchema, isChzzkImageUrl, type ChzzkPost } from "@/features/fanpage/domain/chzzk-posts";

export const CHZZK_POSTS_URL = `https://apis.naver.com/nng_main/nng_comment_api/v1/type/CHANNEL_POST/id/${CHZZK_CHANNEL_ID}/comments?limit=10&offset=0&orderType=DESC&pagingType=PAGE`;
const responseSchema = z.object({
  code: z.literal(200),
  content: z.object({ comments: z.object({ data: z.array(z.unknown()).max(10) }) }),
});
const entrySchema = z.object({
  comment: z.object({
    commentId: z.number().int().positive().safe(),
    objectType: z.literal("CHANNEL_POST"),
    objectId: z.string(),
    secret: z.literal(false), deleted: z.literal(false), hideByCleanBot: z.literal(false),
    content: z.string().max(20_000),
    createdDate: z.string().regex(/^\d{14}$/),
    attaches: z.array(z.object({ attachType: z.string(), attachValue: z.string(), order: z.number() })).max(10).nullable(),
  }),
  user: z.object({ userIdHash: z.string() }),
});
const rawDateSchema = z.object({ comment: z.object({ createdDate: z.string().regex(/^\d{14}$/) }) });

export function parseChzzkPosts(body: unknown, channelId = CHZZK_CHANNEL_ID): ChzzkPost[] {
  const result = responseSchema.parse(body);
  const items: ChzzkPost[] = [];
  for (const value of result.content.comments.data) {
    const parsed = entrySchema.safeParse(value);
    if (!parsed.success || parsed.data.comment.objectId !== channelId || parsed.data.user.userIdHash !== channelId) continue;
    const post = parsed.data.comment;
    const date = post.createdDate;
    const normalized = chzzkPostSchema.safeParse({
      id: String(post.commentId), text: post.content,
      // The provider's compact timestamp has no zone. Keep its calendar date.
      date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
      images: (post.attaches ?? []).filter((image) => image.attachType === "PHOTO" && isChzzkImageUrl(image.attachValue))
        .sort((a, b) => a.order - b.order).map((image) => ({ url: image.attachValue })),
    });
    if (normalized.success && (normalized.data.text.trim() || normalized.data.images.length)
      && !items.some((item) => item.id === normalized.data.id)) items.push(normalized.data);
  }
  return items;
}

async function fetchChzzkPosts(fetcher: typeof fetch): Promise<ChzzkPost[]> {
  const response = await fetcher(CHZZK_POSTS_URL, {
    headers: { Accept: "application/json" }, credentials: "omit", redirect: "error",
    signal: AbortSignal.timeout(8_000), cache: "no-store",
  });
  if (!response.ok) throw new Error("CHZZK unavailable");
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error("CHZZK response too large");
  return parseChzzkPosts(JSON.parse(text));
}

// Bounded per-process cache. Never serve expired posts when revalidation fails:
// the creator may have deleted a post or changed its visibility in the meantime.
export function createChzzkReader(fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  let cached: { items: ChzzkPost[]; expires: number } | null = null;
  let pending: Promise<ChzzkPost[]> | null = null;
  return async (): Promise<ChzzkPost[]> => {
    if (cached && now() < cached.expires) return cached.items;
    if (pending) return pending;
    cached = null;
    pending = fetchChzzkPosts(fetcher).then((items) => {
      cached = { items, expires: now() + 900_000 };
      return items;
    }).finally(() => { pending = null; });
    return pending;
  };
}

export const readChzzkPosts = createChzzkReader();

// Detail reads recheck visibility on every request, including older posts.
export async function readChzzkPost(id: string, fetcher: typeof fetch = fetch, channelId = CHZZK_CHANNEL_ID): Promise<ChzzkPost | null> {
  if (!/^[1-9]\d{0,14}$/.test(id)) return null;
  const url = `${CHZZK_POSTS_URL.split("?")[0]!.replace(CHZZK_CHANNEL_ID, channelId)}/${id}`;
  const response = await fetcher(url, {
    headers: { Accept: "application/json" }, credentials: "omit", redirect: "error",
    signal: AbortSignal.timeout(8_000), cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("CHZZK unavailable");
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error("CHZZK response too large");
  const body = z.object({ code: z.literal(200), content: z.unknown() }).parse(JSON.parse(text));
  const items = parseChzzkPosts({ code: 200, content: { comments: { data: [body.content] } } }, channelId);
  return items.find((post) => post.id === id) ?? null;
}

export type ChzzkPage = { items: ChzzkPost[]; nextCursor: string | null };
export function parseChzzkPage(body: unknown, offset: number, channelId = CHZZK_CHANNEL_ID): ChzzkPage {
  const parsed = z.object({code:z.literal(200),content:z.object({comments:z.object({data:z.array(z.unknown()).max(10),totalCount:z.number().int().nonnegative().optional()}).optional()})}).parse(body);
  const comments = parsed.content.comments;
  if (!comments) return {items:[],nextCursor:null};
  const consumed = offset + comments.data.length;
  return {items:parseChzzkPosts(body,channelId),nextCursor:comments.data.length > 0 && (comments.totalCount === undefined ? comments.data.length === 10 : consumed < comments.totalCount) ? String(consumed) : null};
}
export function createChzzkPageReader(fetcher: typeof fetch = fetch, now = Date.now) {
  const cache = new Map<string,{page:ChzzkPage;expires:number}>();
  return async (channelId: string, cursor: string | null = null): Promise<ChzzkPage> => {
    if (!/^[a-f0-9]{32}$/.test(channelId) || (cursor !== null && !/^(0|[1-9]\d{0,8})$/.test(cursor))) throw Error("Invalid CHZZK cursor or channel");
    const offset = Number(cursor ?? "0");
    const key = `${channelId}:${offset}`;
    const cached = cache.get(key);
    if (cached && cached.expires > now()) return cached.page;
    cache.delete(key);
    const url = new URL(CHZZK_POSTS_URL.replace(CHZZK_CHANNEL_ID,channelId));
    url.searchParams.set("offset",String(offset));
    const response = await fetcher(url.toString(),{headers:{Accept:"application/json"},credentials:"omit",redirect:"error",signal:AbortSignal.timeout(8000),cache:"no-store"});
    if (!response.ok) throw Error("CHZZK unavailable");
    const text = await response.text();
    if (text.length > 1_000_000) throw Error("CHZZK response too large");
    const page = parseChzzkPage(JSON.parse(text),offset,channelId);
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key,{page,expires:now()+900_000});
    return page;
  };
}
export const readChzzkPage = createChzzkPageReader();

export type ChzzkCheckpoint = {
  offset: number;
  anchor: string | null;
  fingerprint: string;
  count: number;
};

export type ChzzkWindow = {
  items: Array<{ item: ChzzkPost; after: ChzzkCheckpoint; hasMore: boolean }>;
  start: ChzzkCheckpoint;
  hasMore: boolean;
  frontier: string | null;
  truncated: boolean;
};

const checkpointSchema = z.object({
  offset: z.number().int().min(0).max(999_999_999),
  anchor: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  count: z.number().int().min(0).max(10),
}).strict();
const MAX_CHZZK_WINDOW_ROWS = 60;

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const fingerprint = (ids: readonly string[]) => digest(ids.join("\n"));
function rawId(value: unknown): string {
  const parsed = entrySchema.safeParse(value);
  return digest(parsed.success ? String(parsed.data.comment.commentId) : `invalid:${JSON.stringify(value)}`);
}

type RawRow = { offset: number; identity: string; signature: string; value: unknown };
type RawPage = { rows: RawRow[]; hasMore: boolean };

function createRawChzzkPageReader(fetcher: typeof fetch, now: () => number) {
  const cache = new Map<string, { page: RawPage; expires: number }>();
  return async (channelId: string, offset: number, bypassCache: boolean): Promise<RawPage> => {
    const key = `${channelId}:${offset}`;
    const cached = cache.get(key);
    if (!bypassCache && cached && cached.expires > now()) return cached.page;
    cache.delete(key);
    const url = new URL(CHZZK_POSTS_URL.replace(CHZZK_CHANNEL_ID, channelId));
    url.searchParams.set("offset", String(offset));
    const response = await fetcher(url.toString(), {
      headers: { Accept: "application/json" }, credentials: "omit", redirect: "error",
      signal: AbortSignal.timeout(8_000), cache: "no-store",
    });
    if (!response.ok) throw new Error("CHZZK unavailable");
    const text = await response.text();
    if (text.length > 1_000_000) throw new Error("CHZZK response too large");
    const body = responseSchema.extend({
      content: z.object({ comments: z.object({
        data: z.array(z.unknown()).max(10),
        totalCount: z.number().int().nonnegative().optional(),
      }) }),
    }).parse(JSON.parse(text));
    const values = body.content.comments.data;
    const consumed = offset + values.length;
    const page = {
      rows: values.map((value, index) => ({ offset: offset + index, identity: rawId(value), signature: digest(JSON.stringify(value)), value })),
      hasMore: values.length > 0 && (body.content.comments.totalCount === undefined ? values.length === 10 : consumed < body.content.comments.totalCount),
    };
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, { page, expires: now() + 900_000 });
    return page;
  };
}

export function createChzzkWindowReader(fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  const readRawPage = createRawChzzkPageReader(fetcher, now);
  return async (channelId: string, rawCheckpoint: ChzzkCheckpoint | null, wanted: number): Promise<ChzzkWindow> => {
    if (!/^[a-f0-9]{32}$/.test(channelId) || !Number.isInteger(wanted) || wanted < 1 || wanted > 51) {
      throw new Error("Invalid CHZZK window");
    }
    const checkpoint = rawCheckpoint === null ? null : checkpointSchema.parse(rawCheckpoint);
    const firstOffset = checkpoint?.offset ?? 0;
    let offset = firstOffset;
    let providerHasMore = true;
    let first = true;
    const rows: RawRow[] = [];
    const accepted: Array<{ item: ChzzkPost; rawOffset: number }> = [];

    while (providerHasMore && rows.length < MAX_CHZZK_WINDOW_ROWS && accepted.length < wanted) {
      const page = await readRawPage(channelId, offset, checkpoint !== null && first);
      if (first && checkpoint) {
        const compared = page.rows.slice(0, checkpoint.count);
        if (compared.length !== checkpoint.count || compared[0]?.identity !== checkpoint.anchor
          || fingerprint(compared.map(row => row.signature)) !== checkpoint.fingerprint) {
          throw new Error("FEED_CURSOR_EXPIRED");
        }
      }
      first = false;
      rows.push(...page.rows);
      for (const row of page.rows) {
        const item = parseChzzkPosts({ code: 200, content: { comments: { data: [row.value] } } }, channelId)[0];
        if (item) accepted.push({ item, rawOffset: row.offset });
      }
      providerHasMore = page.hasMore;
      if (!page.rows.length) break;
      offset += page.rows.length;
    }

    const processedEnd = offset;
    const truncated = providerHasMore && rows.length >= MAX_CHZZK_WINDOW_ROWS && accepted.length < wanted;
    const frontierRow = truncated ? rows.findLast(row => rawDateSchema.safeParse(row.value).success) : undefined;
    const frontierEntry = frontierRow ? rawDateSchema.safeParse(frontierRow.value) : null;
    const frontier = frontierEntry?.success
      ? `${frontierEntry.data.comment.createdDate.slice(0, 4)}-${frontierEntry.data.comment.createdDate.slice(4, 6)}-${frontierEntry.data.comment.createdDate.slice(6, 8)}T00:00:00.000Z`
      : null;
    if (providerHasMore) {
      const lookahead = await readRawPage(channelId, processedEnd, false);
      rows.push(...lookahead.rows);
    }

    const position = (at: number): ChzzkCheckpoint => {
      const unread = rows.filter(row => row.offset >= at).slice(0, 10);
      return { offset: at, anchor: unread[0]?.identity ?? null, fingerprint: fingerprint(unread.map(row => row.signature)), count: unread.length };
    };
    const startOffset = accepted[0]?.rawOffset ?? processedEnd;
    const items = accepted.map(({ item, rawOffset }, index) => {
      const nextOffset = accepted[index + 1]?.rawOffset ?? processedEnd;
      return { item, after: position(nextOffset), hasMore: index + 1 < accepted.length || providerHasMore };
    });
    return { items, start: position(startOffset), hasMore: items.length > 0 || providerHasMore, frontier, truncated };
  };
}

export const readChzzkWindow = createChzzkWindowReader();
