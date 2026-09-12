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
// A missing permission list is never silently accepted. Numeric IDs are read losslessly below.
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

type ProviderDiagnosticStage = "short_token" | "long_token" | "profile" | "refresh_token" | "media" | "revoke";
type ProviderDiagnosticReason = "transport_error" | "response_json_invalid" | "provider_error" | "http_error" | "schema_invalid" | "permission_missing" | "identity_mismatch";
type ProviderDiagnostic = {
  stage: ProviderDiagnosticStage;
  reason: ProviderDiagnosticReason;
  httpStatus?: number;
  providerCode?: number;
  invalidFields?: Array<"envelope" | "access_token" | "user_id" | "permissions">;
  unsafeNumericId?: boolean;
};
type ProviderDiagnosticLogger = (event: ProviderDiagnostic) => void;

function defaultProviderDiagnostic(event: ProviderDiagnostic) {
  console.warn("instagram_provider_failure", event);
}

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

export function createInstagramProvider(
  config: { appId: string; appSecret: string; redirectUri: string; graphVersion: string; remoteRevocationVerified?: boolean },
  transport: typeof fetch = fetch,
  diagnostic: ProviderDiagnosticLogger = defaultProviderDiagnostic,
): InstagramProvider {
  if (!/^v\d+\.0$/.test(config.graphVersion)) throw new Error("Instagram Graph version must be explicit");
  const root = `https://graph.instagram.com/${config.graphVersion}`;

  function report(event: ProviderDiagnostic) {
    try {
      diagnostic(event);
    } catch {
      // Diagnostics must never change the provider result.
    }
  }

  async function call(stage: ProviderDiagnosticStage, url: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await transport(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000) });
    } catch {
      report({ stage, reason: "transport_error" });
      throw new InstagramError("UNAVAILABLE");
    }
    let body: unknown;
    try {
      // Node 24 exposes the original numeric lexeme through reviver context.
      // Instagram may send IDs beyond Number.MAX_SAFE_INTEGER as JSON numbers;
      // response.json() would round them before identity verification can run.
      body = stage === "short_token"
        ? JSON.parse(await response.text(), (key: string, value: unknown, context?: { source?: string }) => {
          if (key !== "user_id" || typeof value !== "number") return value;
          if (!context?.source || !/^[1-9]\d{0,29}$/.test(context.source)) throw new InstagramError("INVALID_RESPONSE");
          return context.source;
        })
        : await response.json();
    } catch {
      report({ stage, reason: "response_json_invalid", httpStatus: response.status });
      throw new InstagramError("INVALID_RESPONSE");
    }
    const error = z.object({ error: z.object({ code: z.number().int().safe().optional() }) }).safeParse(body);
    if (!response.ok || error.success) {
      report({
        stage,
        reason: error.success ? "provider_error" : "http_error",
        httpStatus: response.status,
        ...(error.success && error.data.error.code !== undefined ? { providerCode: error.data.error.code } : {}),
      });
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
      const result = await call("short_token", "https://api.instagram.com/oauth/access_token", {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: config.appId, client_secret: config.appSecret, grant_type: "authorization_code", redirect_uri: config.redirectUri, code }),
      });
      const shortResponse = shortResponseSchema.safeParse(result);
      if (!shortResponse.success) {
        const envelope = z.object({ data: z.array(z.unknown()).length(1) }).safeParse(result);
        const candidate = envelope.success ? envelope.data.data[0] : result;
        const row = z.record(z.string(), z.unknown()).safeParse(candidate);
        const invalidFields: NonNullable<ProviderDiagnostic["invalidFields"]> = [];
        if (!row.success) invalidFields.push("envelope");
        else {
          if (!shortTokenSchema.shape.access_token.safeParse(row.data.access_token).success) invalidFields.push("access_token");
          if (!shortTokenSchema.shape.user_id.safeParse(row.data.user_id).success) invalidFields.push("user_id");
          if (!shortTokenSchema.shape.permissions.safeParse(row.data.permissions).success) invalidFields.push("permissions");
        }
        report({ stage: "short_token", reason: "schema_invalid", invalidFields,
          unsafeNumericId: row.success && typeof row.data.user_id === "number" && !Number.isSafeInteger(row.data.user_id) });
        throw new InstagramError("INVALID_RESPONSE");
      }
      const short = shortResponse.data;
      if (!short.permissions.includes("instagram_business_basic")) {
        report({ stage: "short_token", reason: "permission_missing" });
        throw new InstagramError("REAUTH_REQUIRED");
      }
      // Meta requires secrets in the query for this endpoint. Never log outgoing URLs.
      const query = new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: config.appSecret, access_token: short.access_token });
      const long = tokenSchema.safeParse(await call("long_token", `https://graph.instagram.com/access_token?${query}`));
      if (!long.success) {
        report({ stage: "long_token", reason: "schema_invalid" });
        throw new InstagramError("INVALID_RESPONSE");
      }
      const profile = instagramIdentitySchema.safeParse(await call("profile", `${root}/me?fields=id,user_id,username,account_type`, { headers: bearer(long.data.access_token) }));
      if (!profile.success) {
        report({ stage: "profile", reason: "schema_invalid" });
        throw new InstagramError("INVALID_RESPONSE");
      }
      // Instagram exposes both scoped and professional IDs. Never equate the two namespaces.
      if (profile.data.id !== short.user_id) {
        report({ stage: "profile", reason: "identity_mismatch" });
        throw new InstagramError("ACCOUNT_MISMATCH");
      }
      return { token: { accessToken: long.data.access_token, expiresIn: long.data.expires_in }, identity: profile.data };
    },
    async refresh(accessToken) {
      const query = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: accessToken });
      const result = tokenSchema.safeParse(await call("refresh_token", `https://graph.instagram.com/refresh_access_token?${query}`));
      if (!result.success) {
        report({ stage: "refresh_token", reason: "schema_invalid" });
        throw new InstagramError("INVALID_RESPONSE");
      }
      return { accessToken: result.data.access_token, expiresIn: result.data.expires_in };
    },
    async media(accessToken, identity) {
      const fields = "id,media_type,media_product_type,media_url,thumbnail_url,permalink,caption,timestamp,children{media_type,media_url,thumbnail_url}";
      const query = new URLSearchParams({ fields, limit: "25" });
      return normalizeMedia(await call("media", `${root}/${identity.user_id}/media?${query}`, { headers: bearer(accessToken) }), identity);
    },
    async revoke(accessToken, userId) {
      // Graph's generic permissions reference is insufficient proof for this login product.
      // Keep the optional remote call off until exercised against the selected Meta app.
      if (!config.remoteRevocationVerified) throw new InstagramError("UNAVAILABLE");
      instagramId.parse(userId);
      await call("revoke", `${root}/${userId}/permissions`, { method: "DELETE", headers: bearer(accessToken) });
    },
  };
}
