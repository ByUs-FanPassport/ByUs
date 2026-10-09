import { z } from "zod";
import { chzzkPostSchema } from "@/features/fanpage/domain/chzzk-posts";
import { cheerCommentSchema } from "@/features/fanpage/domain/fan-community";
import { noticeSchema, postSchema } from "./content";

export const feedSourceSchema = z.enum(["all", "official", "fans"]);
export type FeedSource = z.infer<typeof feedSourceSchema>;

export const fanPostFeedItemSchema = postSchema.extend({ kind: z.literal("fan_post") });
export const cheerFeedItemSchema = cheerCommentSchema.extend({ kind: z.literal("cheer") });
export const noticeFeedItemSchema = noticeSchema.omit({ kind: true }).extend({
  kind: z.literal("notice"),
  noticeKind: z.enum(["standard", "welcome"]),
  commentCount: z.number().int().nonnegative(),
});
export const chzzkFeedItemSchema = chzzkPostSchema.extend({ kind: z.literal("chzzk") });
export const feedItemSchema = z.discriminatedUnion("kind", [
  fanPostFeedItemSchema,
  cheerFeedItemSchema,
  noticeFeedItemSchema,
  chzzkFeedItemSchema,
]);
export type FeedItem = z.infer<typeof feedItemSchema>;

export const feedPageSchema = z.object({
  items: z.array(feedItemSchema).max(50),
  nextCursor: z.string().nullable(),
  unavailableSources: z.array(z.literal("chzzk")).max(1).default([]),
}).strict();
export type FeedPage = z.infer<typeof feedPageSchema>;
