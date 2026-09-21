import { type AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/features__passport__domain__passport-read-model";
import { additionalLocales } from "@/i18n/messages";
import { z } from "zod";
import { nicknameSchema } from "../../profile/domain/nickname-schema";
import { fanStageProgressSchema } from "../../rewards/domain/fan-stage";
import type { PhotoSet } from "../../media/domain/public-image";

export const passportLocaleSchema = z.enum(["ko", "en"]);
export type PassportLocale = z.infer<typeof passportLocaleSchema>;

export const stampTypeSchema = z.enum(["knowledge", "reservation", "attendance", "survey", "membership"]);
export const activityTypeSchema = stampTypeSchema;
export const activitySourceTypeSchema = z.enum([
  "quiz_pass",
  "live_reservation",
  "live_attendance",
  "live_survey_response",
  "certification_submission",
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
  membership: "certification_submission",
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
  if ((value.sourceType === "quiz_pass" || value.sourceType === "certification_submission") && value.live !== null) {
    context.addIssue({ code: "custom", message: "Non-LIVE activity cannot contain LIVE context" });
  }
  if (value.sourceType !== "quiz_pass" && value.sourceType !== "certification_submission" && value.live === null) {
    context.addIssue({ code: "custom", message: "LIVE activity lacks source context" });
  }
});

export const STAMP_METADATA = {
  knowledge: {
    label: { ko: "팬 인증", en: "Fan Verification" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m95f58ad617d8[translationLocale]))
},
    shortLabel: { ko: "인증", en: "VERIFY" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m2bddd66cf984[translationLocale]))
},
    inkToken: "oklch(45% 0.14 24)",
  },
  reservation: {
    label: { ko: "라이브 예약", en: "Live Reservation" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m7b7c90f28fee[translationLocale]))
},
    shortLabel: { ko: "예약", en: "RESERVE" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m69b01836073b[translationLocale]))
},
    inkToken: "oklch(46% 0.13 290)",
  },
  attendance: {
    label: { ko: "라이브 출석", en: "Live Attendance" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m6dd9defca075[translationLocale]))
},
    shortLabel: { ko: "출석", en: "ATTEND" ,
  ...additionalLocales((translationLocale) => (localizedMessages.ma6c0372c5682[translationLocale]))
},
    inkToken: "oklch(43% 0.12 235)",
  },
  survey: {
    label: { ko: "후기 참여", en: "Survey" ,
  ...additionalLocales((translationLocale) => (localizedMessages.mf4698d9889c0[translationLocale]))
},
    shortLabel: { ko: "후기", en: "SURVEY" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m7606d201a86b[translationLocale]))
},
    inkToken: "oklch(43% 0.11 155)",
  },
  membership: {
    label: { ko: "멤버십 인증", en: "Membership Verification" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m3647db038a98[translationLocale]))
},
    shortLabel: { ko: "멤버십", en: "MEMBER" ,
  ...additionalLocales((translationLocale) => (localizedMessages.m2a7e9201753e[translationLocale]))
},
    inkToken: "oklch(38% 0.1 75)",
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
  imagePosition: z.string().trim().min(1).max(100).optional(),
  photos: z.custom<PhotoSet>().optional(),
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
  membership: z.number().int().nonnegative().optional().default(0),
  total: z.number().int().nonnegative(),
}).strict().superRefine((value, context) => {
  if (value.total !== value.knowledge + value.reservation + value.attendance + value.survey + value.membership) {
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
  score: z.object({ points: z.number().int().nonnegative(), level: levelSchema, stageProgress: fanStageProgressSchema.nullable().optional() }).strict(),
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

  ...additionalLocales((translationLocale) => ({
    levels: { Bronze: localizedMessages.m860246902e14[translationLocale], Silver: localizedMessages.mc0892217f397[translationLocale], Gold: localizedMessages.me12a6f61ff09[translationLocale], Platinum: localizedMessages.me2f02b0acb25[translationLocale], Diamond: localizedMessages.mcc8c85f578b9[translationLocale] },
    mint: { queued: localizedMessages.m3900c3c60003[translationLocale], processing: localizedMessages.m960398fe947c[translationLocale], retryable: localizedMessages.mb3ae54b62c6b[translationLocale], permanent_failure: localizedMessages.mf578f89ce4d5[translationLocale], minted: localizedMessages.m02dc46521d60[translationLocale] },
  }))
} as const;

export function levelLabel(locale: AppLocale, level: z.infer<typeof levelSchema>): string { return labels[locale].levels[level]; }
export function stampTypeLabel(locale: AppLocale, type: PassportStampType): string { return STAMP_METADATA[type].label[locale]; }
export function stampShortLabel(locale: AppLocale, type: PassportStampType): string { return STAMP_METADATA[type].shortLabel[locale]; }
export function mintStatusLabel(locale: AppLocale, status: z.infer<typeof mintStatusSchema>): string { return labels[locale].mint[status]; }
