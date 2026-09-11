import { z } from "zod";
import { commentSchema } from "./community";

const characterUrlSchema = z.string().regex(
  /^\/images\/avatars\/(?:star|heart|fairy|ghost)-(?:cream|pink|lavender)\.webp$/,
);
const nicknameSchema = z.string().min(1).max(80);

export const fanCommunitySchema = z.object({
  likeCount: z.number().int().nonnegative(),
  fanCount: z.number().int().nonnegative(),
  publicFanCount: z.number().int().nonnegative(),
  fans: z.array(z.object({
    nickname: nicknameSchema,
    avatarUrl: characterUrlSchema,
  }).strict()).max(24),
}).strict();

export const cheerCommentSchema = commentSchema;
export type CheerComment = z.infer<typeof cheerCommentSchema>;

export const cheerPageSchema = z.object({
  total: z.number().int().nonnegative(),
  comments: z.array(cheerCommentSchema).max(20),
  nextCursor: z.string().nullable(),
}).strict();

export const postCheerSchema = z.object({
  body: z.string().trim().min(1).max(1000),
  idempotencyKey: z.uuid(),
}).strict();
