import "server-only";

import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT, type JWTVerifyGetKey } from "jose";
import { z } from "zod";

import {
  APPLE_KEY_ID, APPLE_SERVICE_ID, APPLE_TEAM_ID,
  providerSubjectHash, sha256, type ReauthenticationProvider,
} from "./apple-lifecycle";

const APPLE_JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"), { timeoutDuration: 5_000 });
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), { timeoutDuration: 5_000 });

export interface ReauthenticationProviderConfig {
  origin: string;
  googleClientId: string;
  googleClientSecret: string;
  applePrivateKey: string;
}

const configurationSchema = z.object({
  origin: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value
      && !url.username && !url.password;
  }),
  googleClientId: z.string().endsWith(".apps.googleusercontent.com"),
  googleClientSecret: z.string().min(8),
  applePrivateKey: z.string().includes("-----BEGIN PRIVATE KEY-----"),
});

export function loadReauthenticationProviderConfig(source: NodeJS.ProcessEnv = process.env): ReauthenticationProviderConfig {
  const result = configurationSchema.safeParse({
    origin: source.NEXT_PUBLIC_APP_URL,
    googleClientId: source.APPLE_REAUTH_GOOGLE_CLIENT_ID,
    googleClientSecret: source.APPLE_REAUTH_GOOGLE_CLIENT_SECRET,
    applePrivateKey: source.APPLE_REAUTH_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  });
  if (!result.success) throw new Error("Provider reauthentication configuration is incomplete");
  return result.data;
}

export function reauthenticationCallbackUri(config: ReauthenticationProviderConfig, provider: ReauthenticationProvider): string {
  return `${config.origin}/api/auth/apple/reauth/callback/${provider}`;
}

export function reauthenticationAuthorizationUrl(input: {
  config: ReauthenticationProviderConfig;
  provider: ReauthenticationProvider;
  state: string;
  nonce: string;
}): string {
  const { config, provider, state, nonce } = input;
  const url = new URL(provider === "apple"
    ? "https://appleid.apple.com/auth/authorize"
    : "https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", provider === "apple" ? APPLE_SERVICE_ID : config.googleClientId);
  url.searchParams.set("redirect_uri", reauthenticationCallbackUri(config, provider));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("scope", provider === "apple" ? "email" : "openid email");
  // Apple requires form_post when requesting a scope. Only its dedicated
  // challenge cookie uses SameSite=None; ordinary application cookies do not.
  if (provider === "apple") url.searchParams.set("response_mode", "form_post");
  else url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export async function boundedText(body: Request | Response, limit: number): Promise<string> {
  const contentLength = Number(body.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > limit) throw new Error("Request is too large");
  if (!body.body) return "";
  const reader = body.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > limit) {
        await reader.cancel();
        throw new Error("Request is too large");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

interface ProviderVerificationOptions {
  fetch?: typeof fetch;
  keySet?: JWTVerifyGetKey;
  now?: Date;
}

/** Exchanges a one-use code and verifies a nonce-bearing provider identity. */
export async function verifyReauthenticationCode(input: {
  config: ReauthenticationProviderConfig;
  provider: ReauthenticationProvider;
  code: string;
  expectedNonceHash: string;
  expectedSubjectHash: string;
}, options: ProviderVerificationOptions = {}): Promise<string> {
  const { config, provider } = input;
  const now = options.now ?? new Date();
  const timestamp = Math.floor(now.getTime() / 1_000);
  const clientId = provider === "apple" ? APPLE_SERVICE_ID : config.googleClientId;
  let clientSecret = config.googleClientSecret;
  if (provider === "apple") {
    const key = await importPKCS8(config.applePrivateKey, "ES256");
    clientSecret = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: APPLE_KEY_ID })
      .setIssuer(APPLE_TEAM_ID).setSubject(APPLE_SERVICE_ID)
      .setAudience("https://appleid.apple.com")
      .setIssuedAt(timestamp).setExpirationTime(timestamp + 300).sign(key);
  }
  const response = await (options.fetch ?? fetch)(provider === "apple"
    ? "https://appleid.apple.com/auth/token"
    : "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code: input.code,
      client_id: clientId, client_secret: clientSecret,
      redirect_uri: reauthenticationCallbackUri(config, provider),
    }),
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Provider reauthentication failed");
  const tokens = z.object({ id_token: z.string().min(1).max(16_384) })
    .parse(JSON.parse(await boundedText(response, 32_768)));
  const { payload } = await jwtVerify(tokens.id_token,
    options.keySet ?? (provider === "apple" ? APPLE_JWKS : GOOGLE_JWKS), {
      algorithms: ["RS256"],
      issuer: provider === "apple" ? "https://appleid.apple.com" : ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
      requiredClaims: ["iss", "aud", "sub", "iat", "exp", "nonce"],
      maxTokenAge: "10m",
      currentDate: now,
      clockTolerance: 30,
    });
  if (typeof payload.nonce !== "string" || sha256(payload.nonce) !== input.expectedNonceHash
    || typeof payload.sub !== "string" || !payload.sub
    || (payload.azp !== undefined && payload.azp !== clientId)
    || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)) {
    throw new Error("Provider identity does not match the challenge");
  }
  const subjectHash = providerSubjectHash(provider, payload.sub);
  if (subjectHash !== input.expectedSubjectHash) throw new Error("Provider identity does not match the challenge");
  return subjectHash;
}
