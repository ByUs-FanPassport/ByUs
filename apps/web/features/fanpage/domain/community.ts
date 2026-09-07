import { z } from "zod";

export const celebritySlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120);
const characterUrl = z.string().regex(/^\/images\/avatars\/(?:star|heart|fairy|ghost)-(?:cream|pink|lavender)\.webp$/);
const nickname = z.string().min(1).max(80);
const row = z.object({ rank: z.number().int().positive(), nickname, avatarUrl: characterUrl, points: z.number().int().nonnegative() }).strict();
export const fanpageSummarySchema = z.object({
  membershipCount: z.number().int().nonnegative(),
  leaderboardAvailable: z.boolean(),
  activity: z.array(z.object({
    kind: z.enum(["joined", "level_up", "first_certification"]), tier: z.enum(["Bronze", "Silver", "Gold", "Platinum", "Diamond"]).nullable(),
    nickname, avatarUrl: characterUrl, occurredAt: z.iso.datetime({ offset: true }),
  }).strict()).max(6),
}).strict();
export type FanpageSummary = z.infer<typeof fanpageSummarySchema>;
export const leaderboardSchema = z.object({
  membershipCount: z.number().int().nonnegative(), available: z.boolean(), asOf: z.iso.datetime({ offset: true }),
  rows: z.array(row).max(100), me: row.nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.available !== (value.membershipCount > 500) || (!value.available && (value.rows.length || value.me))) {
    ctx.addIssue({ code: "custom", message: "Leaderboard membership boundary mismatch" });
  }
});
export type Leaderboard = z.infer<typeof leaderboardSchema>;
export const commentSchema = z.object({
  id: z.uuid(), body: z.string().min(1).max(1000), nickname, avatarUrl: characterUrl,
  createdAt: z.iso.datetime({ offset: true }), isOwner: z.boolean(),
}).strict();
export const commentsSchema = z.object({ total: z.number().int().nonnegative(), comments: z.array(commentSchema).max(50) }).strict();
export type NoticeComments = z.infer<typeof commentsSchema>;
export const postCommentSchema = z.object({ body: z.string().trim().min(1).max(1000), idempotencyKey: z.uuid() }).strict();
