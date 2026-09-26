import "server-only";
import { z } from "zod";
import { AuthError } from "@/features/auth/domain/auth-errors";
import { celebritySlugSchema } from "@/features/fanpage/domain/community";
import { assetSchema, blocksSchema, commentSchema, createCommentSchema, createPostSchema, editPostSchema, noticeSchema, postSchema, reportInputSchema, reportSchema, targetSchema, translationInputSchema, translationSchema } from "@/features/fan-posts/domain/content";
import { boundedJson, boundedMultipart, CertificationBodyError, json } from "@/server/certification/certification-http";
import { MAX_PUBLIC_IMAGE_BYTES, MAX_PUBLIC_IMAGE_MULTIPART_BYTES, PublicImageError } from "@/server/media/public-image-processing";
import type { FanpageDependencies } from "@/server/fanpage/routes";
import type { AppLocale } from "@/i18n/locales";
import { parseNoticeDocument } from "@/server/notice/notice-domain";

export interface ContentDependencies extends FanpageDependencies {
  upload(owner: string, slug: string, bytes: Uint8Array): Promise<z.infer<typeof assetSchema>>;
  download(path: string): Promise<Blob>;
  translate(text: string, locale: AppLocale): Promise<{ translatedText: string; detectedSourceLocale?: string }>;
}
const cursorSchema = z.object({ at: z.iso.datetime({ offset: true }), id: z.uuid(), pinned: z.boolean().optional() }).strict();
const writeSchema = z.object({ id: z.uuid(), revision: z.number().int().positive(), replayed: z.boolean() }).strict();
function checked<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error("FAN_WEB_UNAVAILABLE");
  return result.data;
}
function one(url: URL, name: string) {
  const all = url.searchParams.getAll(name);
  if (all.length > 1) throw new Error("FAN_WEB_INVALID_INPUT");
  return all[0];
}
function pageParams(request: Request, official = false) {
  const url = new URL(request.url), encoded = one(url, "cursor");
  let cursor: z.infer<typeof cursorSchema> | null = null;
  if (encoded !== undefined) {
    try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(z.string().min(1).max(240).parse(encoded), "base64url").toString("utf8"))); }
    catch { throw new Error("FAN_WEB_INVALID_INPUT"); }
    if (official ? cursor.pinned === undefined : cursor.pinned !== undefined) throw new Error("FAN_WEB_INVALID_INPUT");
  }
  return { p_before: cursor?.at ?? null, p_before_id: cursor?.id ?? null, p_limit: z.coerce.number().int().min(1).max(50).parse(one(url, "limit") ?? 20), p_locale: z.enum(["ko", "en"]).parse(one(url, "locale") ?? "ko"), ...(official ? { p_before_pinned: cursor?.pinned ?? null } : {}) };
}
function page<T extends { id: string; createdAt: string }>(schema: z.ZodType<T>, raw: unknown) {
  const data = checked(z.object({ items: z.array(schema).max(50), hasMore: z.boolean() }).strict(), raw);
  const last = data.items.at(-1);
  return { items: data.items, nextCursor: data.hasMore && last ? Buffer.from(JSON.stringify({ at: last.createdAt, id: last.id })).toString("base64url") : null };
}
export function contentFailure(error: unknown) {
  if (error instanceof AuthError) return json({ error: { code: error.status === 401 ? "AUTHENTICATION_REQUIRED" : "FAN_WEB_FORBIDDEN" } }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: { code: "FAN_WEB_INVALID_INPUT" } }, 400);
  if (error instanceof CertificationBodyError) return json({ error: { code: error.code } }, error.code === "BODY_TOO_LARGE" ? 413 : 400);
  if (error instanceof PublicImageError) return json({ error: { code: error.code } }, error.code === "BODY_TOO_LARGE" ? 413 : 400);
  const code = error instanceof Error ? error.message : "";
  const statuses: Record<string, number> = { FAN_WEB_NOT_FOUND: 404, FAN_WEB_CONFLICT: 409, FAN_WEB_FORBIDDEN: 403, FAN_WEB_ACTIVE_ACCOUNT_REQUIRED: 403,
    FAN_WEB_INVALID_INPUT: 400, FAN_WEB_INVALID_ASSET: 400, FAN_WEB_PRIVATE_ASSET_REQUIRED: 400, FAN_WEB_RATE_LIMITED: 429,
    TRANSLATION_RATE_LIMITED: 429, TRANSLATION_INVALID_INPUT: 400, TRANSLATION_UNAVAILABLE: 503, TRANSLATION_FAILED: 503 };
  return json({ error: { code: statuses[code] ? code : "FAN_WEB_UNAVAILABLE" } }, statuses[code] ?? 503);
}
export function createContentHandlers(deps: ContentDependencies) {
  const owner = async (request: Request, optional = false) => optional && !request.headers.has("authorization") ? null : (await deps.authorize(request.headers.get("authorization"))).appUserId;
  const run = async (action: () => Promise<Response>) => { try { return await action(); } catch (error) { return contentFailure(error); } };
  return {
    notices: (request: Request, slug: string) => run(async () => {
      celebritySlugSchema.parse(slug); const p_app_user_id = await owner(request, true);
      const data = checked(z.object({ notices: z.array(noticeSchema.omit({ body: true })).max(50), hasMore: z.boolean() }).strict(),
        await deps.rpc("read_fan_notices", { p_app_user_id, p_slug: slug, ...pageParams(request, true) }));
      const last = data.notices.at(-1);
      return json({ notices: data.notices, nextCursor: data.hasMore && last ? Buffer.from(JSON.stringify({ at: last.publishedAt, id: last.id, pinned: last.pinned })).toString("base64url") : null });
    }),
    notice: (request: Request, slug: string, noticeSlug: string) => run(async () => {
      celebritySlugSchema.parse(slug); celebritySlugSchema.parse(noticeSlug); const p_app_user_id = await owner(request, true);
      const raw = await deps.rpc("read_fan_notice", { p_app_user_id, p_slug: slug, p_notice_slug: noticeSlug, p_locale: pageParams(request).p_locale });
      if (raw === null) throw new Error("FAN_WEB_NOT_FOUND");
      const notice = checked(noticeSchema, raw);
      return json({ ...notice, body: parseNoticeDocument(notice.body) });
    }),
    posts: (request: Request, slug: string) => run(async () => {
      celebritySlugSchema.parse(slug);
      const p_app_user_id = await owner(request, request.method === "GET");
      if (request.method === "GET") {
        const raw = await deps.rpc("read_fan_posts", { p_app_user_id, p_slug: slug, ...pageParams(request) });
        if (raw === null) throw new Error("FAN_WEB_NOT_FOUND");
        return json(page(postSchema, raw));
      }
      const value = createPostSchema.parse(await boundedJson(request, 32_768));
      return json(checked(writeSchema, await deps.rpc("save_fan_post", { p_app_user_id, p_slug: slug, p_post_id: null, p_body: value.body, p_visibility: value.visibility,
        p_asset_ids: value.assetIds, p_expected_revision: null, p_idempotency_key: value.idempotencyKey })), 201);
    }),
    post: (request: Request, id: string) => run(async () => {
      z.uuid().parse(id);
      const p_app_user_id = await owner(request, request.method === "GET");
      if (request.method === "DELETE") { await deps.rpc("remove_fan_post", { p_app_user_id, p_post_id: id }); return json({ removed: true }); }
      const raw = await deps.rpc("read_fan_post", { p_app_user_id, p_post_id: id, p_locale: pageParams(request).p_locale });
      if (raw === null) throw new Error("FAN_WEB_NOT_FOUND");
      const data = checked(z.object({ post: postSchema }).strict(), raw);
      if (request.method === "GET") return json(data);
      const value = editPostSchema.parse(await boundedJson(request, 32_768));
      if (!data.post.isOwner) throw new Error("FAN_WEB_NOT_FOUND");
      return json(checked(writeSchema, await deps.rpc("save_fan_post", { p_app_user_id, p_slug: data.post.celebritySlug, p_post_id: id, p_body: value.body,
        p_visibility: value.visibility, p_asset_ids: value.assetIds, p_expected_revision: value.expectedRevision, p_idempotency_key: null })));
    }),
    comments: (request: Request, id: string) => run(async () => {
      z.uuid().parse(id);
      const p_app_user_id = await owner(request, request.method === "GET");
      if (request.method === "GET") {
        const raw = await deps.rpc("read_fan_post_comments", { p_app_user_id, p_post_id: id, ...pageParams(request) });
        if (raw === null) throw new Error("FAN_WEB_NOT_FOUND");
        return json(page(commentSchema, raw));
      }
      const value = createCommentSchema.parse(await boundedJson(request, 8192));
      return json(checked(writeSchema, await deps.rpc("post_fan_post_comment", { p_app_user_id, p_post_id: id, p_parent_id: value.parentId, p_body: value.body, p_idempotency_key: value.idempotencyKey })), 201);
    }),
    removeComment: (request: Request, id: string) => run(async () => {
      z.uuid().parse(id); const p_app_user_id = await owner(request);
      await deps.rpc("remove_fan_post_comment", { p_app_user_id, p_comment_id: id }); return json({ removed: true });
    }),
    like: (request: Request, id: string) => run(async () => {
      z.uuid().parse(id); const p_app_user_id = await owner(request);
      const value = z.object({ liked: z.boolean() }).strict().parse(await boundedJson(request, 1024));
      await deps.rpc("set_fan_post_like", { p_app_user_id, p_post_id: id, p_liked: value.liked }); return json(value);
    }),
    upload: (request: Request) => run(async () => {
      const actor = (await owner(request))!;
      const form = await boundedMultipart(request, MAX_PUBLIC_IMAGE_MULTIPART_BYTES), entries = [...form.entries()];
      if (entries.length !== 2 || form.getAll("file").length !== 1 || form.getAll("celebritySlug").length !== 1) throw new Error("FAN_WEB_INVALID_INPUT");
      const slug = celebritySlugSchema.parse(form.get("celebritySlug")), file = form.get("file");
      if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") throw new Error("FAN_WEB_INVALID_INPUT");
      if (file.size > MAX_PUBLIC_IMAGE_BYTES) throw new PublicImageError("BODY_TOO_LARGE");
      return json({ asset: checked(assetSchema, await deps.upload(actor, slug, new Uint8Array(await file.arrayBuffer()))) }, 201);
    }),
    asset: (request: Request, id: string) => run(async () => {
      z.uuid().parse(id); const p_app_user_id = await owner(request, true);
      const adminPreview = one(new URL(request.url), "admin");
      let raw: unknown;
      if (adminPreview !== undefined) {
        if (adminPreview !== "1") throw new Error("FAN_WEB_INVALID_INPUT");
        const admin = await deps.authorizeAdmin(request.headers.get("authorization"), crypto.randomUUID());
        raw = await deps.rpc("read_admin_content_asset", { p_actor_app_user_id: admin.appUserId, p_actor_admin_allowlist_id: admin.allowlistId, p_asset_id: id });
      } else raw = await deps.rpc("read_content_asset", { p_app_user_id, p_asset_id: id });
      if (raw === null) throw new Error("FAN_WEB_NOT_FOUND");
      const value = checked(z.object({ storagePath: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/), mimeType: z.literal("image/webp") }).strict(), raw);
      const bytes = await deps.download(value.storagePath);
      return new Response(bytes, { headers: { "content-type": value.mimeType, "cache-control": "private, no-store", vary: "Authorization", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" } });
    }),
    report: (request: Request) => run(async () => {
      const p_app_user_id = await owner(request), value = reportInputSchema.parse(await boundedJson(request, 8192));
      return json(checked(z.object({ id: z.uuid(), status: z.enum(["open", "resolved", "dismissed"]), replayed: z.boolean() }).strict(),
        await deps.rpc("post_content_report", { p_app_user_id, p_target_type: value.targetType, p_target_id: value.targetId, p_reason: value.reason, p_idempotency_key: value.idempotencyKey })));
    }),
    blocks: (request: Request) => run(async () => {
      const p_app_user_id = await owner(request);
      if (request.method === "GET") return json(checked(blocksSchema, await deps.rpc("read_content_blocks", { p_app_user_id, p_locale: pageParams(request).p_locale })));
      const value = targetSchema.parse(await boundedJson(request, 1024));
      return json(checked(z.object({ id: z.uuid() }).strict(), await deps.rpc("block_content_author", { p_app_user_id, p_target_type: value.targetType, p_target_id: value.targetId })));
    }),
    unblock: (request: Request, id: string) => run(async () => {
      z.uuid().parse(id); const p_app_user_id = await owner(request);
      await deps.rpc("remove_content_block", { p_app_user_id, p_block_id: id }); return json({ removed: true });
    }),
    translate: (request: Request) => run(async () => {
      const p_app_user_id = await owner(request), value = translationInputSchema.parse(await boundedJson(request, 2048));
      const args = { p_app_user_id, p_target_type: value.targetType, p_target_id: value.targetId, p_target_locale: value.targetLocale, p_locale: value.locale };
      const cached = await deps.rpc("read_content_translation", args);
      if (cached !== null) return json(checked(translationSchema, cached));
      const raw = await deps.rpc("fan_web_content_target", { p_app_user_id, p_target_type: value.targetType, p_target_id: value.targetId, p_locale: value.locale });
      if (raw === null) throw new Error("FAN_WEB_NOT_FOUND");
      const target = checked(z.object({ body: z.string(), revision: z.number().int().positive(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/) }), raw);
      const count = Array.from(target.body).length;
      if (!target.body.trim() || count > 20_000) throw new Error("TRANSLATION_INVALID_INPUT");
      await deps.rpc("reserve_content_translation_request", { p_app_user_id, p_character_count: count });
      const result = await deps.translate(target.body, value.targetLocale);
      await deps.rpc("save_content_translation", { ...args, p_source_revision: target.revision, p_source_hash: target.sourceHash, p_translated_text: result.translatedText, p_detected_source_locale: result.detectedSourceLocale ?? null });
      // Recheck after provider latency; source mutation, blocks, or deletion cannot return a stale translation.
      const current = await deps.rpc("read_content_translation", args);
      if (current === null) throw new Error("FAN_WEB_CONFLICT");
      return json({ ...checked(translationSchema, current), cached: false });
    }),
    adminReports: (request: Request) => run(async () => {
      const actor = await deps.authorizeAdmin(request.headers.get("authorization"), crypto.randomUUID());
      const { p_locale: _locale, ...params } = pageParams(request);
      const status = z.enum(["open", "resolved", "dismissed"]).parse(one(new URL(request.url), "status") ?? "open");
      return json(page(reportSchema, await deps.rpc("read_admin_content_reports", { p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId, p_status: status, ...params })));
    }),
    resolveReport: (request: Request, id: string) => run(async () => {
      z.uuid().parse(id); const correlation = crypto.randomUUID(), actor = await deps.authorizeAdmin(request.headers.get("authorization"), correlation);
      if (actor.role === "viewer") throw new Error("FAN_WEB_FORBIDDEN");
      const value = z.object({ resolution: z.enum(["resolved", "dismissed"]), hideTarget: z.boolean(), reason: z.string().trim().min(10).max(500) }).strict().parse(await boundedJson(request, 8192));
      return json(checked(z.object({ id: z.uuid(), status: z.enum(["resolved", "dismissed"]), targetHidden: z.boolean() }).strict(), await deps.rpc("resolve_admin_content_report", {
        p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId, p_correlation_id: correlation, p_report_id: id, p_resolution: value.resolution, p_hide_target: value.hideTarget, p_reason: value.reason })));
    }),
  };
}
