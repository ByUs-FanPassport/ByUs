import { z } from "zod";

export const LOUNGE_EMOJIS = ["❤️", "👍", "😂", "🥹", "🔥", "👏"] as const;

const avatarUrlSchema = z.string().regex(
  /^\/images\/avatars\/(?:star|heart|fairy|ghost)-(?:cream|pink|lavender)\.webp$/,
);
const nicknameSchema = z.string().min(1).max(80);

export const loungeMessageSchema = z.object({
  id: z.uuid(),
  body: z.string().min(1).max(1000),
  nickname: nicknameSchema,
  avatarUrl: avatarUrlSchema,
  createdAt: z.iso.datetime({ offset: true }),
  isOwner: z.boolean(),
  replyTo: z.object({
    id: z.uuid(),
    body: z.string().min(1).max(1000).nullable(),
    nickname: nicknameSchema.nullable(),
  }).strict().superRefine((value, ctx) => {
    if ((value.body === null) !== (value.nickname === null)) {
      ctx.addIssue({ code: "custom", message: "Redacted replies must hide body and nickname together" });
    }
  }).nullable(),
  reactions: z.array(z.object({
    emoji: z.enum(LOUNGE_EMOJIS),
    count: z.number().int().nonnegative(),
    reacted: z.boolean(),
  }).strict()).max(LOUNGE_EMOJIS.length),
}).strict();

export type LoungeMessage = z.infer<typeof loungeMessageSchema>;

export const loungeSchema = z.object({
  likeCount: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  messages: z.array(loungeMessageSchema).max(200),
  nextCursor: z.string().nullable(),
}).strict();

export type Lounge = z.infer<typeof loungeSchema>;

export const postLoungeMessageSchema = z.object({
  body: z.string().trim().min(1).max(1000),
  idempotencyKey: z.uuid(),
  replyToId: z.uuid().nullable().optional(),
}).strict();

export const setLoungeReactionSchema = z.object({
  emoji: z.enum(LOUNGE_EMOJIS),
  enabled: z.boolean(),
}).strict();
