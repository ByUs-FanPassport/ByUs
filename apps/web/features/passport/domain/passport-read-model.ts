import { z } from "zod";
import { nicknameSchema } from "../../profile/domain/nickname-schema";

export const passportLocaleSchema = z.enum(["ko", "en"]);
export type PassportLocale = z.infer<typeof passportLocaleSchema>;

export const stampTypeSchema = z.enum(["knowledge", "reservation", "attendance", "survey"]);
export const activityTypeSchema = stampTypeSchema;
export const activitySourceTypeSchema = z.enum([
  "quiz_pass",
  "live_reservation",
  "live_attendance",
  "live_survey_response",
]);
export const mintStatusSchema = z.enum(["queued", "processing", "retryable", "permanent_failure", "minted"]);
export const levelSchema = z.enum(["Bronze", "Silver", "Gold", "Platinum", "Diamond"]);
export type PassportLevel = z.infer<typeof levelSchema>;
export type PassportStampType = z.infer<typeof stampTypeSchema>;

export const ACTIVITY_SOURCE_BY_TYPE = {
  knowledge: "quiz_pass",
  reservation: "live_reservation",
  attendance: "live_attendance",
  survey: "live_survey_response",
} as const satisfies Record<
  PassportStampType,
  z.infer<typeof activitySourceTypeSchema>
>;

export const passportActivityContextSchema = z.object({
  sourceType: activitySourceTypeSchema,
  sourceId: z.uuid(),
  live: z.object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
    title: z.string().trim().min(1).max(160),
    linkable: z.boolean(),
  }).strict().nullable(),
}).strict().superRefine((value, context) => {
  if (value.sourceType === "quiz_pass" && value.live !== null) {
    context.addIssue({ code: "custom", message: "Quiz activity cannot contain LIVE context" });
  }
  if (value.sourceType !== "quiz_pass" && value.live === null) {
    context.addIssue({ code: "custom", message: "LIVE activity lacks source context" });
  }
});

export const STAMP_METADATA = {
  knowledge: {
    label: { ko: "팬 인증", en: "Fan Verification" },
    shortLabel: { ko: "인증", en: "VERIFY" },
    inkToken: "oklch(45% 0.14 24)",
  },
  reservation: {
    label: { ko: "라이브 예약", en: "Live Reservation" },
    shortLabel: { ko: "예약", en: "RESERVE" },
    inkToken: "oklch(46% 0.13 290)",
  },
  attendance: {
    label: { ko: "라이브 출석", en: "Live Attendance" },
    shortLabel: { ko: "출석", en: "ATTEND" },
    inkToken: "oklch(43% 0.12 235)",
  },
  survey: {
    label: { ko: "후기 참여", en: "Survey" },
    shortLabel: { ko: "후기", en: "SURVEY" },
    inkToken: "oklch(43% 0.11 155)",
  },
} as const satisfies Record<
  PassportStampType,
  {
    label: Record<PassportLocale, string>;
    shortLabel: Record<PassportLocale, string>;
    inkToken: string;
  }
>;

const safeImageUrl = z.string().min(1).refine((value) => {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}, "unsafe image URL");

export const celebritySchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  name: z.string().trim().min(1).max(120),
  image: z.object({
    url: safeImageUrl,
    alt: z.string().trim().min(1).max(300),
    position: z.string().trim().min(1).max(100),
  }).strict(),
}).strict();

export const mintFactsSchema = z.object({
  status: mintStatusSchema,
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).nullable(),
  tokenId: z.string().regex(/^(?:0|[1-9][0-9]*)$/).nullable(),
}).strict().superRefine((value, context) => {
  if (value.status === "minted" && (!value.txHash || !value.tokenId || value.tokenId === "0")) {
    context.addIssue({ code: "custom", message: "Minted credential lacks final chain facts" });
  }
  if (value.status !== "minted" && value.tokenId !== null) {
    context.addIssue({ code: "custom", message: "Pending credential contains a token ID" });
  }
});

export const stampSummarySchema = z.object({
  knowledge: z.number().int().nonnegative(),
  reservation: z.number().int().nonnegative(),
  attendance: z.number().int().nonnegative(),
  survey: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
}).strict().superRefine((value, context) => {
  if (value.total !== value.knowledge + value.reservation + value.attendance + value.survey) {
    context.addIssue({ code: "custom", message: "Stamp summary total is inconsistent" });
  }
});

export const basePassportSchema = z.object({
  id: z.uuid(),
  owner: z.object({ nickname: nicknameSchema.nullable() }).strict(),
  celebrity: celebritySchema,
  businessStatus: z.literal("issued"),
  mint: mintFactsSchema,
  issuedAt: z.iso.datetime({ offset: true }),
  score: z.object({ points: z.number().int().nonnegative(), level: levelSchema }).strict(),
  stampSummary: stampSummarySchema,
}).strict();

const labels = {
  ko: {
    levels: { Bronze: "브론즈", Silver: "실버", Gold: "골드", Platinum: "플래티넘", Diamond: "다이아몬드" },
    mint: { queued: "발급 대기", processing: "발급 중", retryable: "발급 재시도 중", permanent_failure: "발급 확인 필요", minted: "발급 완료" },
  },
  en: {
    levels: { Bronze: "Bronze", Silver: "Silver", Gold: "Gold", Platinum: "Platinum", Diamond: "Diamond" },
    mint: { queued: "Issuance queued", processing: "Issuing", retryable: "Retrying issuance", permanent_failure: "Issuance needs attention", minted: "Issued" },
  },
} as const;

export function levelLabel(locale: PassportLocale, level: z.infer<typeof levelSchema>): string { return labels[locale].levels[level]; }
export function stampTypeLabel(locale: PassportLocale, type: PassportStampType): string { return STAMP_METADATA[type].label[locale]; }
export function stampShortLabel(locale: PassportLocale, type: PassportStampType): string { return STAMP_METADATA[type].shortLabel[locale]; }
export function mintStatusLabel(locale: PassportLocale, status: z.infer<typeof mintStatusSchema>): string { return labels[locale].mint[status]; }
