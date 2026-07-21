import { z } from "zod";

export const passportLocaleSchema = z.enum(["ko", "en"]);
export type PassportLocale = z.infer<typeof passportLocaleSchema>;

export const stampTypeSchema = z.enum(["knowledge", "reservation", "attendance", "survey"]);
export const activityTypeSchema = stampTypeSchema;
export const mintStatusSchema = z.enum(["queued", "processing", "retryable", "permanent_failure", "minted"]);
export const levelSchema = z.enum(["Bronze", "Silver", "Gold", "Platinum", "Diamond"]);

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
  owner: z.object({ nickname: z.null() }).strict(),
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
    stamps: { knowledge: "팬 인증", reservation: "라이브 예약", attendance: "라이브 출석", survey: "후기 참여" },
    mint: { queued: "발급 대기", processing: "발급 중", retryable: "발급 재시도 중", permanent_failure: "발급 확인 필요", minted: "발급 완료" },
  },
  en: {
    levels: { Bronze: "Bronze", Silver: "Silver", Gold: "Gold", Platinum: "Platinum", Diamond: "Diamond" },
    stamps: { knowledge: "Fan Verification", reservation: "Live Reservation", attendance: "Live Attendance", survey: "Survey" },
    mint: { queued: "Issuance queued", processing: "Issuing", retryable: "Retrying issuance", permanent_failure: "Issuance needs attention", minted: "Issued" },
  },
} as const;

export function levelLabel(locale: PassportLocale, level: z.infer<typeof levelSchema>): string { return labels[locale].levels[level]; }
export function stampTypeLabel(locale: PassportLocale, type: z.infer<typeof stampTypeSchema>): string { return labels[locale].stamps[type]; }
export function mintStatusLabel(locale: PassportLocale, status: z.infer<typeof mintStatusSchema>): string { return labels[locale].mint[status]; }

