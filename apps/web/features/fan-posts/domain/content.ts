import { z } from "zod";
import { APP_LOCALES } from "@/i18n/locales";

export const targetTypeSchema = z.enum(["fan_post", "fan_post_comment", "notice", "notice_comment", "cheer", "live_submission"]);
export type TargetType = z.infer<typeof targetTypeSchema>;
export const visibilitySchema = z.enum(["public", "members"]);
const instant = z.iso.datetime({ offset: true });
const avatar = z.string().regex(/^\/images\/avatars\/(?:star|heart|fairy|ghost)-(?:cream|pink|lavender)\.webp$/);
export const authorSchema = z.object({ nickname: z.string().min(1).max(80), avatarUrl: avatar }).strict();
export const assetSchema = z.object({ id: z.uuid(), width: z.number().int().positive(), height: z.number().int().positive() }).strict();
export type ContentAsset = z.infer<typeof assetSchema>;
export const postSchema = z.object({
  id: z.uuid(), celebritySlug: z.string(), body: z.string().max(5000), visibility: visibilitySchema, revision: z.number().int().positive(),
  author: authorSchema, assets: z.array(assetSchema).max(4), createdAt: instant, updatedAt: instant, isOwner: z.boolean(),
  likeCount: z.number().int().nonnegative(), liked: z.boolean(), commentCount: z.number().int().nonnegative(),
}).strict();
export type FanPost = z.infer<typeof postSchema>;
export const commentSchema = z.object({
  id: z.uuid(), postId: z.uuid(), parentId: z.uuid().nullable(), body: z.string().min(1).max(1000), revision: z.number().int().positive(),
  author: authorSchema, createdAt: instant, isOwner: z.boolean(),
}).strict();
export type PostComment = z.infer<typeof commentSchema>;
export const postPageSchema = z.object({ items: z.array(postSchema).max(50), nextCursor: z.string().nullable() }).strict();
export const commentPageSchema = z.object({ items: z.array(commentSchema).max(50), nextCursor: z.string().nullable() }).strict();
export const savePostSchema = z.object({ body: z.string().trim().max(5000), visibility: visibilitySchema, assetIds: z.array(z.uuid()).max(4) }).strict()
  .refine(value => value.body.length > 0 || value.assetIds.length > 0, "Content required")
  .refine(value => new Set(value.assetIds).size === value.assetIds.length, "Duplicate asset");
export const createPostSchema = savePostSchema.safeExtend({ idempotencyKey: z.uuid() });
export const editPostSchema = savePostSchema.safeExtend({ expectedRevision: z.number().int().positive() });
export const createCommentSchema = z.object({ body: z.string().trim().min(1).max(1000), parentId: z.uuid().nullable().default(null), idempotencyKey: z.uuid() }).strict();
export const targetSchema = z.object({ targetType: targetTypeSchema, targetId: z.uuid() }).strict();
export const reportInputSchema = targetSchema.extend({ reason: z.string().trim().min(1).max(500), idempotencyKey: z.uuid() });
export const translationInputSchema = targetSchema.extend({ targetLocale: z.enum(APP_LOCALES), locale: z.enum(["ko", "en"]).default("ko") });
export const translationSchema = z.object({
  targetType: targetTypeSchema, targetId: z.uuid(), targetLocale: z.enum(APP_LOCALES), translatedText: z.string().min(1).max(100_000), sourceRevision: z.number().int().positive(), cached: z.boolean(),
}).strict();
export const blockSchema = z.object({ id: z.uuid(), nickname: z.string(), avatarUrl: avatar, createdAt: instant }).strict();
export const blocksSchema = z.object({ items: z.array(blockSchema) }).strict();
export const reportSchema = z.object({
  id: z.uuid(), targetType: targetTypeSchema, targetId: z.uuid(), targetRevision: z.number().int().positive(),
  reason: z.string(), status: z.enum(["open", "resolved", "dismissed"]), createdAt: instant,
  target: z.object({ body: z.string().nullable(), celebritySlug: z.string() }).strict().nullable(),
}).strict();
export const reportPageSchema = z.object({ items: z.array(reportSchema).max(50), nextCursor: z.string().nullable() }).strict();
export const noticeSchema = z.object({
  id: z.uuid(), slug: z.string(), title: z.string(), pinned: z.boolean(), kind: z.enum(["standard", "welcome"]),
  postType: z.enum(["notice", "artist_post"]), visibility: visibilitySchema, revision: z.number().int().positive(), publishedAt: instant, body: z.unknown(),
}).strict();
