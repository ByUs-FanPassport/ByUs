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
