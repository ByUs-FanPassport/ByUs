import { z } from "zod";

export const notificationKindSchema = z.enum([
  "live_24h",
  "live_10m",
  "live_reserved",
  "live_changed",
  "live_cancelled",
  "benefit_won",
  "recipient_information_required",
  "fulfillment_meaningful_update",
  "collectible_claim_available",
  "collectible_claim_expiring",
  "survey_reminder",
  "benefit_available",
  "level_up",
  "benefit_unlocked",
]);
export const safeNotificationPathSchema = z
  .string()
  .regex(
    /^\/(?:my|passports|live\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/survey)?|benefits\/[0-9a-f-]{36})$/,
  );
export const notificationItemSchema = z.object({
  id: z.uuid(),
  kind: notificationKindSchema,
  title: z.string().min(1),
  detail: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
  readAt: z.iso.datetime({ offset: true }).nullable(),
  deepLink: safeNotificationPathSchema,
});
export const notificationCollectionSchema = z.object({
  notifications: z.array(notificationItemSchema),
  unreadCount: z.number().int().nonnegative(),
});
export const notificationPreferencesSchema = z.object({
  liveReminders: z.boolean(),
  surveyReminders: z.boolean(),
  benefitNotifications: z.boolean(),
  browserSubscription: z.enum(["subscribed", "unsubscribed"]),
});
export type NotificationItem = z.infer<typeof notificationItemSchema>;
export type ExternalNotificationChannelKind = "email" | "kakao";
export type NotificationPreferences = z.infer<
  typeof notificationPreferencesSchema
>;
