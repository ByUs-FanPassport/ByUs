import { z } from "zod";
import { mintFactsSchema } from "../../passport/domain/passport-read-model";

export const communityStampKindSchema = z.enum(["welcome", "first_comment", "subscription", "support", "share", "invite", "daily_checkin"]);
export type CommunityStampKind = z.infer<typeof communityStampKindSchema>;
export const communityCreatorSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
export const communityStampSchema = z.object({
  id: z.uuid(), kind: communityStampKindSchema, celebritySlug: communityCreatorSlugSchema.nullable(),
  issuedAt: z.iso.datetime({ offset: true }), mint: mintFactsSchema,
}).strict().superRefine((stamp, ctx) => {
  if ((stamp.kind === "welcome" || stamp.kind === "invite") !== (stamp.celebritySlug === null)) {
    ctx.addIssue({ code: "custom", message: "Stamp scope does not match its kind" });
  }
});
export type CommunityStamp = z.infer<typeof communityStampSchema>;
export const communityStampCollectionSchema = z.object({
  stamps: z.array(communityStampSchema), today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();
export type CommunityStampCollection = z.infer<typeof communityStampCollectionSchema>;
export const communityInviteSchema = z.object({ code: z.string().min(6).max(32), redeemed: z.boolean() }).strict();
export const communityShareTokenSchema = z.string().regex(/^[a-f0-9]{32}$/);
export const communityShareLinkSchema = z.object({ token: communityShareTokenSchema }).strict();
export const communityShareDestinationSchema = z.object({ creator: communityCreatorSlugSchema }).strict();
export const communityAwardResultSchema = z.object({ awarded: z.boolean() }).strict();

export const COMMUNITY_STAMPS = {
  welcome: { asset: "welcome", ko: "가입기념", en: "Welcome", scope: "account", koHelp: "가입하고 지갑이 만들어지면 받아요.", enHelp: "Join ByUs and create your wallet." },
  first_comment: { asset: "first-comment", ko: "첫 댓글", en: "First comment", scope: "creator", koHelp: "최애에게 첫 댓글을 남겨보세요.", enHelp: "Leave your first comment for your favorite." },
  subscription: { asset: "subscription", ko: "구독인증", en: "Subscription", scope: "creator", koHelp: "최애의 SNS 구독을 인증해요.", enHelp: "Verify your subscription to your favorite." },
  support: { asset: "support", ko: "후원", en: "Support", scope: "creator", koHelp: "최애에게 보낸 후원을 기록해요.", enHelp: "Keep a record of your support." },
  share: { asset: "share", ko: "공유하기", en: "Share", scope: "creator", koHelp: "패스포트 링크를 받은 다른 회원이 로그인 후 최애를 확인하면 받아요.", enHelp: "Earn a Stamp when another member signs in and confirms a visit through your Passport link." },
  invite: { asset: "invite", ko: "친구초대", en: "Invite a friend", scope: "account", koHelp: "친구 코드를 인증하면 둘 다 받아요.", enHelp: "Use a friend’s code to earn a Stamp together." },
  daily_checkin: { asset: "daily-checkin", ko: "출첵", en: "Daily check-in", scope: "creator", koHelp: "최애 캘린더에서 매일 출석해요.", enHelp: "Check in on your favorite’s calendar each day." },
} as const;

// External verification is not public until the matching server proof exists.
export const AVAILABLE_COMMUNITY_STAMPS: readonly CommunityStampKind[] = ["welcome", "first_comment", "daily_checkin", "share", "invite"];
export function communityStampAsset(kind: CommunityStampKind) { return `/images/community-stamps/${COMMUNITY_STAMPS[kind].asset}.png`; }
export function communityStampKstDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
