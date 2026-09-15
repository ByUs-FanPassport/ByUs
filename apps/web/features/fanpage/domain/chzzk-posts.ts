import { z } from "zod";

// Start with the channel whose public posts were verified and requested for ByUs.
export const CHZZK_CREATOR_SLUG = "jenny-jeong";
export const CHZZK_CHANNEL_ID = "0a3f97086cb81d3360c69fdf5d020045";
export const CHZZK_CHANNEL_URL = `https://chzzk.naver.com/${CHZZK_CHANNEL_ID}`;
export const CHZZK_COMMUNITY_URL = `${CHZZK_CHANNEL_URL}/community`;

export function isChzzkImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "nng-phinf.pstatic.net"
      && !url.username && !url.password && !url.port;
  } catch { return false; }
}

export const chzzkPostSchema = z.object({
  id: z.string().regex(/^\d+$/),
  text: z.string().max(20_000),
  date: z.iso.date(),
  images: z.array(z.object({ url: z.string().refine(isChzzkImageUrl) })).max(10),
});
export const chzzkFeedSchema = z.object({ items: z.array(chzzkPostSchema).max(10), nextCursor: z.string().nullable().default(null) });
export type ChzzkPost = z.infer<typeof chzzkPostSchema>;

export function chzzkChannelId(links: readonly { platform: string; url: string }[]): string | null {
  for (const link of links) {
    if (link.platform !== "chzzk") continue;
    try {
      const url = new URL(link.url);
      const match = url.pathname.match(/^\/([a-f0-9]{32})(?:\/community)?\/?$/);
      if (url.protocol === "https:" && url.hostname === "chzzk.naver.com" && !url.username && !url.password && !url.port && match) return match[1]!;
    } catch { /* Ignore malformed published links. */ }
  }
  return null;
}
