import "server-only";
import { z } from "zod";
import { AuthError } from "../../features/auth/domain/auth-errors";
import { celebritySlugSchema, commentsSchema, fanpageSummarySchema, leaderboardSchema, postCommentSchema } from "../../features/fanpage/domain/community";
import type { AdminSession } from "../admin/admin-session-gate";

export interface FanpageDependencies {
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
  authorize(authorization: string | null): Promise<{ appUserId: string }>;
  authorizeAdmin(authorization: string | null, correlationId: string): Promise<AdminSession>;
}
const headers = { "cache-control": "private, no-store", vary: "Authorization" };
export const fanpageJson = (value: unknown, status = 200) => Response.json(value, { status, headers });
export function fanpageFailure(error: unknown) {
  if (error instanceof AuthError) return fanpageJson({ error: { code: "AUTHENTICATION_REQUIRED" } }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return fanpageJson({ error: { code: "INVALID_REQUEST" } }, 400);
  const code = error instanceof Error ? error.message : "";
  const status = ({ FANPAGE_FORBIDDEN: 403, FANPAGE_NOT_FOUND: 404, FANPAGE_RATE_LIMITED: 429, FANPAGE_IDEMPOTENCY_CONFLICT: 409, FANPAGE_INVALID_REQUEST: 400, FANPAGE_BODY_TOO_LARGE: 413 } as Record<string, number>)[code];
  return fanpageJson({ error: { code: status ? code : "FANPAGE_UNAVAILABLE" } }, status ?? 503);
}
async function optionalOwner(request: Request, dependencies: FanpageDependencies) {
  const authorization = request.headers.get("authorization");
  return authorization === null ? null : (await dependencies.authorize(authorization)).appUserId;
}
const cursorSchema = z.object({ at: z.iso.datetime({ offset: true }), id: z.uuid() }).strict();
const adminCommentSchema = z.object({
  id: z.uuid(), body: z.string(), nickname: z.string(), celebritySlug: celebritySlugSchema,
  noticeSlug: celebritySlugSchema, createdAt: z.iso.datetime({ offset: true }),
}).strict();
function decodeCursor(value: string) {
  return cursorSchema.parse(JSON.parse(Buffer.from(z.string().max(240).parse(value), "base64url").toString("utf8")));
}
function encodeCursor(value: z.infer<typeof cursorSchema>) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
function locale(request: Request): "ko" | "en" {
  const values = new URL(request.url).searchParams.getAll("locale");
  if (values.length > 1) throw new Error("FANPAGE_INVALID_REQUEST");
  return z.enum(["ko", "en"]).parse(values[0] ?? "ko");
}
function parseResult<T>(schema: z.ZodType<T>, result: unknown): T {
  const parsed = schema.safeParse(result);
  if (!parsed.success) throw new Error("FANPAGE_INVALID_RESPONSE");
  return parsed.data;
}
async function readSmallJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Missing JSON body");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) { await reader.cancel(); throw new Error("FANPAGE_BODY_TOO_LARGE"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
export function createFanpageHandlers(dependencies: FanpageDependencies) {
  return {
    async visibility(request: Request) {
      try {
        const { appUserId } = await dependencies.authorize(request.headers.get("authorization"));
        const schema = z.object({ enabled: z.boolean() }).strict();
        const input = request.method === "PATCH" ? schema.parse(await readSmallJson(request)) : null;
        const result = await dependencies.rpc(input ? "set_owned_fan_activity_visibility" : "read_owned_fan_activity_visibility", { p_app_user_id: appUserId, ...(input ? { p_enabled: input.enabled } : {}) });
        return fanpageJson(parseResult(schema, result));
      } catch (error) { return fanpageFailure(error); }
    },
    async summary(request: Request, slug: string) {
      try {
        celebritySlugSchema.parse(slug);
        // Reject invalid credentials even though this payload itself is public.
        await optionalOwner(request, dependencies);
        const result = await dependencies.rpc("read_celebrity_fanpage", { p_slug: slug, p_locale: locale(request) });
        if (!result) return fanpageJson({ error: { code: "FANPAGE_NOT_FOUND" } }, 404);
        return fanpageJson(parseResult(fanpageSummarySchema, result));
      } catch (error) { return fanpageFailure(error); }
    },
    async leaderboard(request: Request, slug: string) {
      try {
        celebritySlugSchema.parse(slug);
        const owner = await optionalOwner(request, dependencies);
        const result = await dependencies.rpc("read_celebrity_fan_leaderboard", { p_slug: slug, p_app_user_id: owner, p_locale: locale(request) });
        if (!result) return fanpageJson({ error: { code: "FANPAGE_NOT_FOUND" } }, 404);
        const body = parseResult(leaderboardSchema, result);
        if (!body.available) return fanpageJson({ error: { code: "LEADERBOARD_NOT_AVAILABLE" }, membershipCount: body.membershipCount }, 403);
        return fanpageJson({ ...body, me: owner ? body.me : null });
      } catch (error) { return fanpageFailure(error); }
    },
    async comments(request: Request, slug: string, noticeSlug: string) {
      try {
        celebritySlugSchema.parse(slug); celebritySlugSchema.parse(noticeSlug);
        const owner = await optionalOwner(request, dependencies);
        const url = new URL(request.url);
        const contentLocale = locale(request);
        const limit = z.coerce.number().int().min(1).max(50).parse(url.searchParams.get("limit") ?? 20);
        const cursor = url.searchParams.get("cursor");
        const before = cursor ? decodeCursor(cursor) : null;
        const result = await dependencies.rpc("read_celebrity_notice_comments", {
          p_slug: slug, p_notice_slug: noticeSlug, p_app_user_id: owner, p_limit: limit, p_before: before?.at ?? null, p_before_id: before?.id ?? null, p_locale: contentLocale,
        });
        if (!result) return fanpageJson({ error: { code: "FANPAGE_NOT_FOUND" } }, 404);
        const body = parseResult(commentsSchema, result);
        const last = body.comments.at(-1);
        return fanpageJson({ ...body, nextCursor: body.comments.length === limit && last ? encodeCursor({ at: last.createdAt, id: last.id }) : null });
      } catch (error) { return fanpageFailure(error); }
    },
    async postComment(request: Request, slug: string, noticeSlug: string) {
      try {
        celebritySlugSchema.parse(slug); celebritySlugSchema.parse(noticeSlug);
        const { appUserId } = await dependencies.authorize(request.headers.get("authorization"));
        const input = postCommentSchema.parse(await readSmallJson(request));
        const result = await dependencies.rpc("post_celebrity_notice_comment", {
          p_app_user_id: appUserId, p_slug: slug, p_notice_slug: noticeSlug, p_body: input.body, p_idempotency_key: input.idempotencyKey,
        });
        return fanpageJson(parseResult(z.object({ id: z.uuid(), replayed: z.boolean() }).strict(), result));
      } catch (error) { return fanpageFailure(error); }
    },
    async removeComment(request: Request, id: string) {
      try {
        z.uuid().parse(id);
        const { appUserId } = await dependencies.authorize(request.headers.get("authorization"));
        await dependencies.rpc("remove_owned_notice_comment", { p_app_user_id: appUserId, p_comment_id: id });
        return fanpageJson({ removed: true });
      } catch (error) { return fanpageFailure(error); }
    },
    async hideComment(request: Request, id: string) {
      try {
        z.uuid().parse(id);
        const correlationId = crypto.randomUUID();
        const admin = await dependencies.authorizeAdmin(request.headers.get("authorization"), correlationId);
        const input = z.object({ reason: z.string().trim().min(1).max(500) }).strict().parse(await readSmallJson(request));
        await dependencies.rpc("hide_admin_notice_comment", { p_actor_app_user_id: admin.appUserId, p_actor_admin_allowlist_id: admin.allowlistId,
          p_correlation_id: correlationId, p_comment_id: id, p_reason: input.reason });
        return fanpageJson({ hidden: true });
      } catch (error) { return fanpageFailure(error); }
    },
    async adminComments(request: Request) {
      try {
        const correlationId = crypto.randomUUID();
        const admin = await dependencies.authorizeAdmin(request.headers.get("authorization"), correlationId);
        const url = new URL(request.url);
        const slug = celebritySlugSchema.optional().parse(url.searchParams.get("celebrity") ?? undefined);
        const encodedCursor = url.searchParams.get("cursor");
        const legacyBefore = z.iso.datetime({ offset: true }).optional().parse(url.searchParams.get("before") ?? undefined);
        if (encodedCursor && legacyBefore) throw new Error("FANPAGE_INVALID_REQUEST");
        const before = encodedCursor ? decodeCursor(encodedCursor) : null;
        const baseArgs = {
          p_actor_app_user_id: admin.appUserId,
          p_actor_admin_allowlist_id: admin.allowlistId,
          p_slug: slug ?? null,
        };
        const result = await dependencies.rpc("read_admin_notice_comments", legacyBefore
          ? { ...baseArgs, p_before: legacyBefore }
          : { ...baseArgs, p_before: before?.at ?? null, p_before_id: before?.id ?? null, p_limit: 51 });
        const page = parseResult(z.object({ comments: z.array(adminCommentSchema).max(51) }).strict(), result);
        const comments = page.comments.slice(0, 50);
        const last = comments.at(-1);
        return fanpageJson({
          comments,
          nextCursor: page.comments.length > 50 && last ? encodeCursor({ at: last.createdAt, id: last.id }) : null,
        });
      } catch (error) { return fanpageFailure(error); }
    },
  };
}
