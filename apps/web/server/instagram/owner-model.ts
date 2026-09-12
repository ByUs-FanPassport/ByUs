import { z } from "zod";
import { instagramIdentitySchema, instagramLocale } from "./model";

export const ownerAccountSchema = z.object({
  celebrityId: z.string().uuid(), slug: z.string(), name: z.string(), username: z.string(),
  avatarUrl: z.string().nullable(), generation: z.string().uuid(), liveEnabled: z.boolean(),
  needsReconnect: z.boolean(), mediaStatus: z.enum(["syncing", "connected", "unavailable"]),
});
export type OwnerAccount = z.infer<typeof ownerAccountSchema>;
export const ownerFlowSchema = z.object({
  celebrity_id: z.string().uuid().optional(), generation: z.string().uuid().optional(),
  locale: instagramLocale.default("ko"), stage: z.string().optional(), authorization_started_at: z.string().optional(),
  payload: z.object({ identity: instagramIdentitySchema }).passthrough().optional(),
  account: ownerAccountSchema.optional(),
});
