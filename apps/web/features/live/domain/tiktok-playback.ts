import { z } from "zod";

export const tiktokPlaybackSchema = z.object({
  roomId: z.string().regex(/^[1-9]\d{0,31}$/),
  url: z.string().max(4096).refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash
        && ["tiktokcdn.com", "tiktokcdn-us.com"].some((host) => url.hostname.endsWith(`.${host}`))
        && url.pathname.endsWith(".flv") && Boolean(url.searchParams.get("sign"));
    } catch { return false; }
  }),
  expiresAt: z.iso.datetime(),
});

export const tiktokPlaybackResponseSchema = tiktokPlaybackSchema.extend({ observedAt: z.iso.datetime() });
export type TikTokPlayback = z.infer<typeof tiktokPlaybackSchema>;
