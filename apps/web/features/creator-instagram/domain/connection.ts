import { z } from "zod";

export const creatorInstagramAccountSchema = z.object({
  celebrityId: z.string().uuid(),
  slug: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string(),
  username: z.string().regex(/^[a-zA-Z0-9._]{1,30}$/),
  avatarUrl: z.string().nullable(),
  generation: z.string().uuid(),
  liveEnabled: z.boolean(),
  needsReconnect: z.boolean(),
  mediaStatus: z.enum(["syncing", "connected", "unavailable"]),
});
export type CreatorInstagramAccount = z.infer<typeof creatorInstagramAccountSchema>;
export type CreatorInstagramScreen = "intro" | "confirm" | "manage" | "permissions" | "mismatch" | "disconnect";
