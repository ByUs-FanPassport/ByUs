import "server-only";
import { z } from "zod";
import { InstagramError, instagramId, instagramIdentitySchema, instagramMediaSchema, type InstagramIdentity, type InstagramMedia, type InstagramProvider } from "./model";

const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().int().positive().max(366 * 86400) });
const shortTokenSchema = z.object({
  access_token: z.string().min(1),
  user_id: z.union([instagramId, z.number().int().safe().positive().transform(String)]),
  permissions: z.union([z.string().transform((value) => value.split(",").map((permission) => permission.trim())), z.array(z.string())]),
});
// Current documented data[0] and the earlier flat response are both supported.
// A missing permission list or imprecise numeric ID is never silently accepted.
const shortResponseSchema = z.union([
  z.object({ data: z.array(shortTokenSchema).length(1) }).transform((value) => value.data[0]),
  shortTokenSchema,
]);
const mediaRow = z.object({
  id: instagramId,
  media_type: z.enum(["IMAGE", "VIDEO", "CAROUSEL_ALBUM"]),
  media_product_type: z.string().optional(),
  media_url: z.string().optional(),
  thumbnail_url: z.string().optional(),
  permalink: z.string(),
  caption: z.string().optional(),
  timestamp: z.string(),
  children: z.object({ data: z.array(z.object({ media_type: z.string(), media_url: z.string().optional(), thumbnail_url: z.string().optional() })) }).optional(),
});

export function normalizeMedia(data: unknown, identity: InstagramIdentity): InstagramMedia[] {
  const envelope = z.object({ data: z.array(z.unknown()) }).safeParse(data);
  if (!envelope.success) throw new InstagramError("INVALID_RESPONSE");
  const cards: InstagramMedia[] = [];
  for (const item of envelope.data.data) {
    const parsed = mediaRow.safeParse(item);
    if (!parsed.success) continue;
    const row = parsed.data;
    if (row.media_product_type === "STORY") continue;
    const timestamp = Date.parse(row.timestamp);
    if (!Number.isFinite(timestamp)) continue;
    const child = row.children?.data[0];
    const image = row.media_type === "VIDEO" ? row.thumbnail_url
      : row.media_type === "CAROUSEL_ALBUM" && child
        ? (child.media_type === "VIDEO" ? child.thumbnail_url : child.media_url) ?? row.media_url
        : row.media_url;
    const result = instagramMediaSchema.safeParse({
      id: row.id, mediaType: row.media_type, mediaProductType: row.media_product_type ?? null,
      imageUrl: image, permalink: row.permalink, caption: row.caption ?? "", timestamp: new Date(timestamp).toISOString(),
      sourceAccount: { id: identity.user_id, username: identity.username },
    });
    if (result.success && !cards.some((card) => card.id === result.data.id)) cards.push(result.data);
  }
  return cards.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, 3);
}

export function createInstagramProvider(config: { appId: string; appSecret: string; redirectUri: string; graphVersion: string; remoteRevocationVerified?: boolean }, transport: typeof fetch = fetch): InstagramProvider {
  if (!/^v\d+\.0$/.test(config.graphVersion)) throw new Error("Instagram Graph version must be explicit");
  const root = `https://graph.instagram.com/${config.graphVersion}`;
  async function call(url: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await transport(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000) });
    } catch { throw new InstagramError("UNAVAILABLE"); }
    let body: unknown;
    try { body = await response.json(); } catch { throw new InstagramError("INVALID_RESPONSE"); }
    const error = z.object({ error: z.object({ code: z.number().optional() }) }).safeParse(body);
    if (!response.ok || error.success) {
      if (response.status === 401 || (error.success && error.data.error.code === 190)) throw new InstagramError("REAUTH_REQUIRED");
      throw new InstagramError("UNAVAILABLE");
    }
    return body;
  }
  const bearer = (accessToken: string) => ({ authorization: `Bearer ${accessToken}` });
  return {
    authorizationUrl(state) {
      const url = new URL("https://www.instagram.com/oauth/authorize");
      url.search = new URLSearchParams({ client_id: config.appId, redirect_uri: config.redirectUri, response_type: "code", scope: "instagram_business_basic", state, enable_fb_login: "false", force_reauth: "true" }).toString();
      return url.toString();
    },
    async exchange(code) {
      const result = await call("https://api.instagram.com/oauth/access_token", {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: config.appId, client_secret: config.appSecret, grant_type: "authorization_code", redirect_uri: config.redirectUri, code }),
      });
      const shortResponse = shortResponseSchema.safeParse(result);
      if (!shortResponse.success) throw new InstagramError("INVALID_RESPONSE");
      const short = shortResponse.data;
      if (!short.permissions.includes("instagram_business_basic")) throw new InstagramError("REAUTH_REQUIRED");
      // Meta requires secrets in the query for this endpoint. Never log outgoing URLs.
      const query = new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: config.appSecret, access_token: short.access_token });
      const long = tokenSchema.safeParse(await call(`https://graph.instagram.com/access_token?${query}`));
      if (!long.success) throw new InstagramError("INVALID_RESPONSE");
      const profile = instagramIdentitySchema.safeParse(await call(`${root}/me?fields=id,user_id,username,account_type`, { headers: bearer(long.data.access_token) }));
      if (!profile.success) throw new InstagramError("INVALID_RESPONSE");
      // Instagram exposes both scoped and professional IDs. Never equate the two namespaces.
      if (profile.data.id !== short.user_id) throw new InstagramError("ACCOUNT_MISMATCH");
      return { token: { accessToken: long.data.access_token, expiresIn: long.data.expires_in }, identity: profile.data };
    },
    async refresh(accessToken) {
      const query = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: accessToken });
      const result = tokenSchema.safeParse(await call(`https://graph.instagram.com/refresh_access_token?${query}`));
      if (!result.success) throw new InstagramError("INVALID_RESPONSE");
      return { accessToken: result.data.access_token, expiresIn: result.data.expires_in };
    },
    async media(accessToken, identity) {
      const fields = "id,media_type,media_product_type,media_url,thumbnail_url,permalink,caption,timestamp,children{media_type,media_url,thumbnail_url}";
      const query = new URLSearchParams({ fields, limit: "25" });
      return normalizeMedia(await call(`${root}/${identity.user_id}/media?${query}`, { headers: bearer(accessToken) }), identity);
    },
    async revoke(accessToken, userId) {
      // Graph's generic permissions reference is insufficient proof for this login product.
      // Keep the optional remote call off until exercised against the selected Meta app.
      if (!config.remoteRevocationVerified) throw new InstagramError("UNAVAILABLE");
      instagramId.parse(userId);
      await call(`${root}/${userId}/permissions`, { method: "DELETE", headers: bearer(accessToken) });
    },
  };
}
