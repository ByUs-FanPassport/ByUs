import { z } from "zod";

export const BANKSY_BENEFIT_IDS = new Set(["fff318a6-24c7-4012-8290-3494a55e287c", "81fc87bf-5264-43dd-ba08-95cf2ffc949b", "a2cd7407-282f-42a9-b562-aee70a271de4"]);
export const MIRRORWORLD_BANKSY_LINK_ID = "fa4be7ed-782e-48f2-8537-628e5cd4e920";
export const BANKSY_LANDING = "/c/elina/raffles";
export const banksyDestinations = {
  exhibition: "https://www.ehyundai.com/newCulture/EH/EH000001_V.do?seq=2092865&bbsCd=210&eventState=",
  goods: "https://beepio.cc/product/%EB%B0%A9%EB%AC%B8%EC%98%88%EC%95%BD-%EB%B1%85%ED%81%AC%EC%8B%9C-%EC%BC%80%EC%9D%B4%EC%8A%A4-%C2%B7-%EB%8D%94%ED%98%84%EB%8C%80-6%EC%B8%B5-%EA%B5%BF%EC%A6%88%EC%83%B5-%ED%98%84%EC%9E%A5-%EA%B2%B0%EC%A0%9C/23/",
} as const;
export const banksyDestinationSchema = z.enum(["exhibition", "goods"]);
export const banksySurfaceSchema = z.enum(["raffle_list", "raffle_receipt"]);
export const campaignLinkInputSchema = z.object({
  creator: z.enum(["elina", "byus"]),
  channel: z.enum(["instagram", "tiktok", "youtube", "facebook", "x", "mirrorworld", "other"]),
  contentType: z.enum(["story", "reel", "video", "post", "bio", "other"]),
  name: z.string().trim().min(1).max(80),
  locale: z.enum(["ko", "en"]),
}).strict();
export const campaignCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), id: z.uuid(), ...campaignLinkInputSchema.shape }).strict(),
  z.object({ action: z.literal("stop"), id: z.uuid() }).strict(),
]);
export const campaignVisitInputSchema = z.object({
  sessionId: z.uuid(), firstLinkId: z.uuid().nullable(), linkId: z.uuid().nullable(), sequence: z.number().int().min(0).max(1_000_000),
}).strict();
export const campaignLinkSchema = campaignLinkInputSchema.extend({ id: z.uuid(), active: z.boolean(), createdAt: z.iso.datetime({ offset: true }) });
export type CampaignLink = z.infer<typeof campaignLinkSchema>;
export type CampaignCommand = z.infer<typeof campaignCommandSchema>;
export const campaignStatsSchema = z.object({ visits: z.number().int().nonnegative(), outboundSessions: z.number().int().nonnegative() });
export const campaignReportSchema = z.object({
  from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }),
  totals: campaignStatsSchema,
  sources: z.array(campaignStatsSchema.extend({ linkId: z.uuid().nullable() })),
  destinations: z.array(z.object({ destination: banksyDestinationSchema, requests: z.number().int().nonnegative(), sessions: z.number().int().nonnegative() })),
  legacyRequests: z.number().int().nonnegative(),
  mirrorworldLegacyRequests: z.number().int().nonnegative().default(0),
});
export type CampaignReport = z.infer<typeof campaignReportSchema>;
export const campaignAdminDataSchema = z.object({ links: z.array(campaignLinkSchema), report: campaignReportSchema });
export type CampaignAdminData = z.infer<typeof campaignAdminDataSchema>;

export function campaignWindow(days: 7 | 30 | 90, now: Date) {
  const kst = new Date(now.getTime() + 9 * 60 * 60_000);
  const start = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - days + 1) - 9 * 60 * 60_000;
  return { from: new Date(start).toISOString(), to: now.toISOString() };
}

export function campaignOutboundHref(destination: keyof typeof banksyDestinations, surface: z.infer<typeof banksySurfaceSchema>, visitId?: string | null, requestId?: string) {
  const query = new URLSearchParams({ surface });
  if (visitId && z.uuid().safeParse(visitId).success) query.set("visit", visitId);
  if (requestId && z.uuid().safeParse(requestId).success) query.set("request", requestId);
  return `/o/banksy/${destination}?${query}`;
}
