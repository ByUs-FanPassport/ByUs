import { z } from "zod";
import { myRewardSchema } from "../../benefit/domain/my-reward";
import { FAN_TIERS } from "../../rewards/domain/reward-policy";

const safeImageUrl = z.string().min(1).refine((value) => value.startsWith("/") || value.startsWith("https://"));
const dateTime = z.string().datetime({ offset: true });
const uuid = z.string().uuid();

const liveItemSchema = z.object({
  id: uuid,
  slug: z.string().trim().min(1),
  title: z.string().trim().min(1),
  startsAt: dateTime,
  effectiveStatus: z.enum(["scheduled", "live", "ended", "cancelled"]),
  attended: z.boolean(),
}).strict();

export const mySummarySchema = z.object({
  profile: z.object({ nickname: z.string().nullable() }).strict(),
  creators: z.array(z.object({
    celebrity: z.object({ slug: z.string(), name: z.string(), image: safeImageUrl }).strict(),
    relationship: z.enum(["passport", "first_reaction_only"]),
    passport: z.object({
      id: uuid,
      tier: z.enum(FAN_TIERS),
      score: z.number().int().nonnegative(),
      remainingToNextTier: z.number().int().nonnegative(),
    }).strict().nullable(),
    ticketBalance: z.number().int().nonnegative(),
    firstReaction: z.object({ completedAt: dateTime, txHash: z.string().trim().min(1).nullable() }).strict().nullable(),
  }).strict()),
  live: z.object({ upcoming: z.array(liveItemSchema), history: z.array(liveItemSchema) }).strict(),
  rewards: z.object({
    availableCount: z.number().int().nonnegative(),
    entries: z.number().int().nonnegative(),
    items: z.array(myRewardSchema),
  }).strict(),
  collection: z.object({
    passportCount: z.number().int().nonnegative(),
    stampCount: z.number().int().nonnegative(),
    collectibleCount: z.number().int().nonnegative(),
    recent: z.array(z.object({
      kind: z.enum(["stamp", "collectible"]),
      id: uuid,
      title: z.string().trim().min(1),
      occurredAt: dateTime,
      href: z.string().regex(/^\/(?:passports\/[0-9a-f-]{36}|live\/[a-z0-9-]+)$/),
    }).strict()).max(12),
  }).strict(),
  unreadNotificationCount: z.number().int().nonnegative(),
}).strict();

export type MySummary = z.infer<typeof mySummarySchema>;
