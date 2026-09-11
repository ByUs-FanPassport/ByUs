import { z } from "zod";

export const certificationLocaleSchema = z.enum(["ko", "en"]);
export type CertificationLocale = z.infer<typeof certificationLocaleSchema>;
export const membershipPlatformSchema = z.enum(["instagram", "tiktok", "youtube"]);
export type MembershipPlatform = z.infer<typeof membershipPlatformSchema>;

const safeCreatorAccountUrlSchema = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, "unsafe creator account URL");

export const certificationRewardSchema = z.object({
  scorePoints: z.number().int().min(0).max(100),
  ticketAmount: z.number().int().min(0).max(1_000_000),
  stampCount: z.literal(1).optional(),
}).strict();

export const certificationListItemSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["quiz", "live_mission", "manual"]),
  category: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(1200),
  status: z.enum(["available", "preparing", "closed"]),
  reward: certificationRewardSchema.nullable(),
  actionHref: z.string().startsWith("/"),
  membershipPlatform: membershipPlatformSchema.optional(),
}).strict();
export type CertificationListItem = z.infer<typeof certificationListItemSchema>;

export const manualCertificationSchema = z.object({
  id: z.uuid(), kind: z.literal("manual"),
  celebrity: z.object({ slug: z.string().min(1), name: z.string().min(1) }).strict(),
  category: z.string().min(1), title: z.string().min(1), description: z.string(), instructions: z.string().min(1),
  status: z.enum(["available", "preparing", "closed"]),
  opensAt: z.iso.datetime({ offset: true }), closesAt: z.iso.datetime({ offset: true }),
  reward: certificationRewardSchema,
  membershipPlatform: membershipPlatformSchema.optional(),
  creatorAccountUrl: safeCreatorAccountUrlSchema.optional(),
}).strict();
export type ManualCertification = z.infer<typeof manualCertificationSchema>;

export const submissionStatusSchema = z.enum(["pending", "approved", "rejected"]);
export const submissionSchema = z.object({
  id: z.uuid(), missionId: z.uuid(), title: z.string().min(1), status: submissionStatusSchema,
  attemptNumber: z.number().int().positive(), note: z.string().nullable(), rejectionReason: z.string().nullable(),
  revision: z.number().int().positive(), submittedAt: z.iso.datetime({ offset: true }), reviewedAt: z.iso.datetime({ offset: true }).nullable(),
  reward: certificationRewardSchema,
  uploads: z.array(z.object({ id: z.uuid(), contentType: z.literal("image/webp"), width: z.number().int().positive(), height: z.number().int().positive() }).strict()).max(3),
  membershipPlatform: membershipPlatformSchema.optional(),
}).strict();
export type CertificationSubmission = z.infer<typeof submissionSchema>;

export const historyItemSchema = z.object({
  id: z.uuid(), kind: z.enum(["quiz","live_mission","manual"]), missionId: z.uuid(), title: z.string().min(1), status: submissionStatusSchema,
  attemptNumber: z.number().int().positive(), rejectionReason: z.string().nullable(), submittedAt: z.iso.datetime({ offset: true }),
  reviewedAt: z.iso.datetime({ offset: true }).nullable(), actionHref: z.string().startsWith("/"),
  membershipPlatform: membershipPlatformSchema.optional(),
}).strict();
export type CertificationHistoryItem = z.infer<typeof historyItemSchema>;

export function membershipPlatformLabel(platform: MembershipPlatform): string {
  return ({ instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" } as const)[platform];
}
