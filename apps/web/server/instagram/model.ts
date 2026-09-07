import { z } from "zod";

export const instagramId = z.string().regex(/^\d{1,30}$/);
export const instagramUsername = z.string().regex(/^[A-Za-z0-9._]{1,30}$/).transform((value) => value.toLowerCase());
export const opaqueSecret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

const httpsUrl = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
});
const permalink = httpsUrl.refine((value) => {
  const url = new URL(value);
  return ["www.instagram.com", "instagram.com"].includes(url.hostname)
    && /^\/(p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
});

export const instagramIdentitySchema = z.object({
  id: instagramId,
  user_id: instagramId,
  username: instagramUsername,
  account_type: z.enum(["BUSINESS", "MEDIA_CREATOR", "CREATOR"]),
});
export type InstagramIdentity = z.infer<typeof instagramIdentitySchema>;

export const instagramMediaSchema = z.object({
  id: instagramId,
  mediaType: z.enum(["IMAGE", "VIDEO", "CAROUSEL_ALBUM"]),
  mediaProductType: z.string().max(40).nullable(),
  imageUrl: httpsUrl,
  permalink,
  caption: z.string().max(10000),
  timestamp: z.string().datetime({ offset: true }),
  sourceAccount: z.object({ id: instagramId, username: instagramUsername }),
});
export type InstagramMedia = z.infer<typeof instagramMediaSchema>;

export interface InstagramToken {
  accessToken: string;
  expiresIn: number;
}
export interface InstagramProvider {
  authorizationUrl(state: string): string;
  exchange(code: string): Promise<{ token: InstagramToken; identity: InstagramIdentity }>;
  refresh(accessToken: string): Promise<InstagramToken>;
  media(accessToken: string, identity: InstagramIdentity): Promise<InstagramMedia[]>;
  revoke(accessToken: string, userId: string): Promise<void>;
}

export class InstagramError extends Error {
  constructor(public readonly code: "UNAVAILABLE" | "REAUTH_REQUIRED" | "INVALID_RESPONSE" | "ACCOUNT_MISMATCH") {
    super(code);
    this.name = "InstagramError";
  }
}

export const flowSchema = z.object({
  celebrity_id: z.string().uuid(),
  generation: z.string().uuid(),
  expected_username: instagramUsername,
  expected_user_id: instagramId.nullable(),
  payload: z.record(z.string(), z.unknown()).default({}),
  expires_at: z.string(),
  celebrity_slug: z.string().optional(),
  celebrity_name: z.string().optional(),
});
export type InstagramFlow = z.infer<typeof flowSchema>;

export const connectionSchema = z.object({
  celebrity_id: z.string().uuid(),
  generation: z.string().uuid(),
  identity: instagramIdentitySchema,
  token_ciphertext: z.string(),
  token_issued_at: z.string(),
  token_expires_at: z.string(),
  lease_id: z.string().uuid(),
});
export type InstagramConnection = z.infer<typeof connectionSchema>;
