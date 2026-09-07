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
        const result = await dependencies.rpc("read_celebrity_fanpage", { p_slug: slug });
        if (!result) return fanpageJson({ error: { code: "FANPAGE_NOT_FOUND" } }, 404);
        return fanpageJson(parseResult(fanpageSummarySchema, result));
      } catch (error) { return fanpageFailure(error); }
    },
    async leaderboard(request: Request, slug: string) {
      try {
        celebritySlugSchema.parse(slug);
        const owner = await optionalOwner(request, dependencies);
        const result = await dependencies.rpc("read_celebrity_fan_leaderboard", { p_slug: slug, p_app_user_id: owner });
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
        const limit = z.coerce.number().int().min(1).max(50).parse(url.searchParams.get("limit") ?? 20);
        const cursor = url.searchParams.get("cursor");
        const before = cursor ? cursorSchema.parse(JSON.parse(Buffer.from(z.string().max(240).parse(cursor), "base64url").toString("utf8"))) : null;
        const result = await dependencies.rpc("read_celebrity_notice_comments", {
          p_slug: slug, p_notice_slug: noticeSlug, p_app_user_id: owner, p_limit: limit, p_before: before?.at ?? null, p_before_id: before?.id ?? null,
        });
        if (!result) return fanpageJson({ error: { code: "FANPAGE_NOT_FOUND" } }, 404);
        const body = parseResult(commentsSchema, result);
        const last = body.comments.at(-1);
        return fanpageJson({ ...body, nextCursor: body.comments.length === limit && last ? Buffer.from(JSON.stringify({ at: last.createdAt, id: last.id })).toString("base64url") : null });
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
        const before = z.iso.datetime({ offset: true }).optional().parse(url.searchParams.get("before") ?? undefined);
        const result = await dependencies.rpc("read_admin_notice_comments", { p_actor_app_user_id: admin.appUserId, p_actor_admin_allowlist_id: admin.allowlistId, p_slug: slug ?? null, p_before: before ?? null });
        return fanpageJson(parseResult(z.object({ comments: z.array(z.object({ id: z.uuid(), body: z.string(), nickname: z.string(), celebritySlug: celebritySlugSchema, noticeSlug: celebritySlugSchema, createdAt: z.iso.datetime({ offset: true }) }).strict()).max(50) }).strict(), result));
      } catch (error) { return fanpageFailure(error); }
    },
  };
}
