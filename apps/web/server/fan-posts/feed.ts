import "server-only";
import { z } from "zod";
import { AuthError } from "@/features/auth/domain/auth-errors";
import { celebritySlugSchema } from "@/features/fanpage/domain/community";
import {
  cheerFeedItemSchema,
  fanPostFeedItemSchema,
  feedPageSchema,
  feedSourceSchema,
  noticeFeedItemSchema,
  type FeedItem,
} from "@/features/fan-posts/domain/feed";
import type { ChzzkCheckpoint, ChzzkWindow } from "@/server/chzzk/community";
import type { FanpageDependencies } from "@/server/fanpage/routes";
import { parseNoticeDocument } from "@/server/notice/notice-domain";

const contentLocaleSchema = z.enum(["ko", "en"]);
const newsSchema = z.enum(["notice", "artist_post", "chzzk"]);
const dbItemSchema = z.discriminatedUnion("kind", [fanPostFeedItemSchema, cheerFeedItemSchema, noticeFeedItemSchema]);
const dbCursorSchema = z.object({
  rank: z.number().int().min(0).max(2), at: z.iso.datetime({ offset: true }),
  kind: z.enum(["notice", "fan_post", "cheer"]), id: z.uuid(),
}).strict();
const chzzkCursorSchema = z.object({
  offset: z.number().int().min(0).max(999_999_999),
  anchor: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), count: z.number().int().min(0).max(10),
}).strict();
const cursorSchema = z.object({
  v: z.literal(1), slug: celebritySlugSchema, source: feedSourceSchema, news: newsSchema.nullable(), locale: contentLocaleSchema,
  db: dbCursorSchema.nullable(), dbDone: z.boolean(), chzzk: chzzkCursorSchema.nullable(), chzzkDone: z.boolean(),
}).strict();
type FeedCursor = z.infer<typeof cursorSchema>;
const dbResultSchema = z.object({
  entries: z.array(z.object({ pinRank: z.number().int().min(0).max(2), item: dbItemSchema }).strict()).max(51),
  hasMore: z.boolean(),
}).strict();

export interface FeedDependencies extends FanpageDependencies {
  chzzkChannel(slug: string, locale: "ko" | "en"): Promise<string | null>;
  readChzzk(channelId: string, checkpoint: ChzzkCheckpoint | null, wanted: number): Promise<ChzzkWindow>;
}

const headers = { "cache-control": "private, no-store", vary: "Authorization" };
const response = (value: unknown, status = 200) => Response.json(value, { status, headers });

function single(url: URL, name: string): string | null {
  const values = url.searchParams.getAll(name);
  if (values.length > 1) throw new Error("FAN_WEB_INVALID_INPUT");
  return values[0] ?? null;
}

function decodeCursor(value: string | null): FeedCursor | null {
  if (value === null) return null;
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(z.string().min(1).max(2048).parse(value), "base64url").toString("utf8")));
  } catch {
    throw new Error("FAN_WEB_INVALID_INPUT");
  }
}

const encodeCursor = (cursor: FeedCursor) => Buffer.from(JSON.stringify(cursor)).toString("base64url");
const itemTime = (item: FeedItem) => item.kind === "notice" ? item.publishedAt
  : item.kind === "chzzk" ? `${item.date}T00:00:00.000Z` : item.createdAt;
const itemId = (item: FeedItem) => item.id;

type Candidate = {
  pinRank: number; item: FeedItem; source: "db" | "chzzk"; sourceOrder: number;
  dbCursor?: z.infer<typeof dbCursorSchema>; chzzkAfter?: ChzzkCheckpoint; chzzkHasMore?: boolean;
};

function compare(left: Candidate, right: Candidate) {
  if (left.pinRank !== right.pinRank) return right.pinRank - left.pinRank;
  const time = Date.parse(itemTime(right.item)) - Date.parse(itemTime(left.item));
  if (time) return time;
  if (left.source === right.source) return left.sourceOrder - right.sourceOrder;
  const kind = right.item.kind.localeCompare(left.item.kind);
  return kind || itemId(right.item).localeCompare(itemId(left.item));
}

function dbCursor(pinRank: number, item: z.infer<typeof dbItemSchema>): z.infer<typeof dbCursorSchema> {
  return { rank: pinRank, at: itemTime(item), kind: item.kind, id: item.id };
}

export function feedFailure(error: unknown) {
  if (error instanceof AuthError) return response({ error: { code: error.status === 401 ? "AUTHENTICATION_REQUIRED" : "FAN_WEB_FORBIDDEN" } }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return response({ error: { code: "FAN_WEB_INVALID_INPUT" } }, 400);
  const code = error instanceof Error ? error.message : "";
  if (code === "FEED_CURSOR_EXPIRED") return response({ error: { code } }, 409);
  if (code === "FAN_WEB_INVALID_INPUT") return response({ error: { code } }, 400);
  if (code === "FAN_WEB_NOT_FOUND") return response({ error: { code } }, 404);
  return response({ error: { code: "FAN_WEB_UNAVAILABLE" } }, 503);
}

export function createFeedHandler(dependencies: FeedDependencies) {
  return async (request: Request, slug: string): Promise<Response> => {
    try {
      celebritySlugSchema.parse(slug);
      const url = new URL(request.url);
      const source = feedSourceSchema.parse(single(url, "source") ?? "all");
      const news = newsSchema.nullable().parse(single(url, "news"));
      const locale = contentLocaleSchema.parse(single(url, "locale") ?? "ko");
      const limit = z.coerce.number().int().min(1).max(50).parse(single(url, "limit") ?? 20);
      const cursor = decodeCursor(single(url, "cursor"));
      if (cursor && (cursor.slug !== slug || cursor.source !== source || cursor.news !== news || cursor.locale !== locale)) throw new Error("FAN_WEB_INVALID_INPUT");
      const authorization = request.headers.get("authorization");
      const owner = authorization === null ? null : (await dependencies.authorize(authorization)).appUserId;
      const includeChzzk = source !== "fans" && (news === null || news === "chzzk") && !cursor?.chzzkDone;

      const dbPromise = cursor?.dbDone ? Promise.resolve({ entries: [], hasMore: false }) : dependencies.rpc("read_unified_creator_feed", {
        p_app_user_id: owner, p_slug: slug, p_source: source, p_news: news,
        p_before_rank: cursor?.db?.rank ?? null, p_before_at: cursor?.db?.at ?? null,
        p_before_kind: cursor?.db?.kind ?? null, p_before_id: cursor?.db?.id ?? null,
        p_limit: limit + 1, p_locale: locale,
      });
      const channelPromise = includeChzzk
        ? dependencies.chzzkChannel(slug, locale).then(value => ({ value, failed: false as const })).catch(() => ({ value: null, failed: true as const }))
        : Promise.resolve({ value: null, failed: false as const });
      const [rawDb, channel] = await Promise.all([dbPromise, channelPromise]);
      const channelId = channel.value;
      if (rawDb === null) throw new Error("FAN_WEB_NOT_FOUND");
      const db = dbResultSchema.parse(rawDb);
      for (const entry of db.entries) {
        if (entry.item.kind === "notice") entry.item.body = parseNoticeDocument(entry.item.body);
      }

      let chzzk: ChzzkWindow | null = null;
      const unavailableSources: "chzzk"[] = [];
      if (channel.failed) unavailableSources.push("chzzk");
      if (includeChzzk && channelId) {
        try {
          chzzk = await dependencies.readChzzk(channelId, cursor?.chzzk ?? null, limit + 1);
        } catch (error) {
          if (error instanceof Error && error.message === "FEED_CURSOR_EXPIRED") throw error;
          unavailableSources.push("chzzk");
        }
      }

      const holdUnpinned: (item: z.infer<typeof dbItemSchema>) => boolean = chzzk?.truncated
        ? chzzk.items.length === 0 || chzzk.frontier === null
          ? () => true
          : (item: z.infer<typeof dbItemSchema>) => Date.parse(itemTime(item)) <= Date.parse(chzzk.frontier!)
        : () => false;
      const visibleDb = db.entries.filter(entry => entry.pinRank > 0 || !holdUnpinned(entry.item));

      const candidates: Candidate[] = [
        ...visibleDb.map((entry, sourceOrder) => ({ pinRank: entry.pinRank, item: entry.item, source: "db" as const, sourceOrder,
          dbCursor: dbCursor(entry.pinRank, entry.item) })),
        ...(chzzk?.items.map((entry, sourceOrder) => ({ pinRank: 0, item: { ...entry.item, kind: "chzzk" as const }, source: "chzzk" as const, sourceOrder,
          chzzkAfter: entry.after, chzzkHasMore: entry.hasMore })) ?? []),
      ].sort(compare);
      const selected = candidates.slice(0, limit);
      let nextDbCursor = cursor?.db ?? null;
      let nextChzzkCursor = chzzk?.start ?? cursor?.chzzk ?? null;
      let consumedDb = 0;
      let consumedChzzk = 0;
      let selectedChzzkHasMore = chzzk?.hasMore ?? false;
      for (const entry of selected) {
        if (entry.source === "db") {
          consumedDb += 1;
          nextDbCursor = entry.dbCursor!;
        } else {
          consumedChzzk += 1;
          nextChzzkCursor = entry.chzzkAfter!;
          selectedChzzkHasMore = entry.chzzkHasMore!;
        }
      }
      const dbDone = consumedDb === db.entries.length && !db.hasMore;
      const chzzkDone = unavailableSources.length > 0 || !includeChzzk || !channelId
        || (consumedChzzk === (chzzk?.items.length ?? 0) && !selectedChzzkHasMore);
      const nextCursor = dbDone && chzzkDone ? null : encodeCursor({
        v: 1, slug, source, news, locale, db: nextDbCursor, dbDone,
        chzzk: nextChzzkCursor, chzzkDone,
      });
      return response(feedPageSchema.parse({ items: selected.map(entry => entry.item), nextCursor, unavailableSources }));
    } catch (error) {
      return feedFailure(error);
    }
  };
}
