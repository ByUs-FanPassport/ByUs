import { TextEncoder as NodeTextEncoder } from "node:util";

import type { CryptoKey, JWTPayload } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const NOW = new Date("2026-09-10T10:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1_000);
const NONCE = "provider-nonce-1";
const GOOGLE_CLIENT_ID = "byus-test.apps.googleusercontent.com";
const GOOGLE_SUBJECT = "google-subject-1";
const APPLE_SUBJECT = "apple-subject-1";

let SignJWT: typeof import("jose").SignJWT;
let jwtVerify: typeof import("jose").jwtVerify;
let createLocalJWKSet: typeof import("jose").createLocalJWKSet;
let idTokenPrivateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let idTokenKeySet: ReturnType<typeof import("jose").createLocalJWKSet>;
let appleClientPublicKey: CryptoKey;
let config: import("./reauthentication-provider").ReauthenticationProviderConfig;
let verifyReauthenticationCode: typeof import("./reauthentication-provider").verifyReauthenticationCode;
let reauthenticationAuthorizationUrl: typeof import("./reauthentication-provider").reauthenticationAuthorizationUrl;
let loadReauthenticationProviderConfig: typeof import("./reauthentication-provider").loadReauthenticationProviderConfig;
let sha256: typeof import("./apple-lifecycle").sha256;
let providerSubjectHash: typeof import("./apple-lifecycle").providerSubjectHash;
let APPLE_KEY_ID: typeof import("./apple-lifecycle").APPLE_KEY_ID;
let APPLE_SERVICE_ID: typeof import("./apple-lifecycle").APPLE_SERVICE_ID;
let APPLE_TEAM_ID: typeof import("./apple-lifecycle").APPLE_TEAM_ID;

beforeAll(async () => {
  const NodeUint8Array = new NodeTextEncoder().encode("").constructor;
  Object.defineProperty(globalThis, "Uint8Array", { configurable: true, value: NodeUint8Array });
  Object.defineProperty(globalThis, "TextEncoder", { configurable: true, value: NodeTextEncoder });

  const jose = await import("jose");
  const provider = await import("./reauthentication-provider");
  const lifecycle = await import("./apple-lifecycle");
  SignJWT = jose.SignJWT;
  jwtVerify = jose.jwtVerify;
  createLocalJWKSet = jose.createLocalJWKSet;
  verifyReauthenticationCode = provider.verifyReauthenticationCode;
  reauthenticationAuthorizationUrl = provider.reauthenticationAuthorizationUrl;
  loadReauthenticationProviderConfig = provider.loadReauthenticationProviderConfig;
  sha256 = lifecycle.sha256;
  providerSubjectHash = lifecycle.providerSubjectHash;
  APPLE_KEY_ID = lifecycle.APPLE_KEY_ID;
  APPLE_SERVICE_ID = lifecycle.APPLE_SERVICE_ID;
  APPLE_TEAM_ID = lifecycle.APPLE_TEAM_ID;

  const idTokenKeys = await jose.generateKeyPair("RS256");
  const wrongKeys = await jose.generateKeyPair("RS256");
  const appleClientKeys = await jose.generateKeyPair("ES256", { extractable: true });
  idTokenPrivateKey = idTokenKeys.privateKey;
  otherPrivateKey = wrongKeys.privateKey;
  appleClientPublicKey = appleClientKeys.publicKey;
  idTokenKeySet = createLocalJWKSet({
    keys: [{ ...(await jose.exportJWK(idTokenKeys.publicKey)), alg: "RS256", kid: "idp-key", use: "sig" }],
  });
  config = {
    origin: "https://byus.test",
    googleClientId: GOOGLE_CLIENT_ID,
    googleClientSecret: "google-client-secret",
    applePrivateKey: await jose.exportPKCS8(appleClientKeys.privateKey),
  };
});

function claims(
  provider: "google" | "apple",
  overrides: Partial<JWTPayload> = {},
): JWTPayload {
  return {
    iss: provider === "apple" ? "https://appleid.apple.com" : "https://accounts.google.com",
    aud: provider === "apple" ? APPLE_SERVICE_ID : GOOGLE_CLIENT_ID,
    sub: provider === "apple" ? APPLE_SUBJECT : GOOGLE_SUBJECT,
    iat: NOW_SECONDS,
    exp: NOW_SECONDS + 300,
    nonce: NONCE,
    ...overrides,
  };
}

async function idToken(
  provider: "google" | "apple",
  overrides: Partial<JWTPayload> = {},
  key: CryptoKey = idTokenPrivateKey,
): Promise<string> {
  return new SignJWT(claims(provider, overrides))
    .setProtectedHeader({ alg: "RS256", kid: "idp-key" })
    .sign(key);
}

function tokenFetch(token: string, status = 200, extraHeaders: HeadersInit = {}) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id_token: token }), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  }));
}

async function verify(provider: "google" | "apple", token: string, fetchMock = tokenFetch(token)) {
  const subject = provider === "apple" ? APPLE_SUBJECT : GOOGLE_SUBJECT;
  return {
    fetchMock,
    result: await verifyReauthenticationCode({
      config,
      provider,
      code: "one-use-code",
      expectedNonceHash: sha256(NONCE),
      expectedSubjectHash: providerSubjectHash(provider, subject),
    }, { fetch: fetchMock, keySet: idTokenKeySet, now: NOW }),
  };
}

describe("provider reauthentication crypto verification", () => {
  it("verifies a Google ID token and uses only Google's fixed token and callback URIs", async () => {
    const { fetchMock, result } = await verify("google", await idToken("google"));
    expect(result).toBe(providerSubjectHash("google", GOOGLE_SUBJECT));
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0];
    const body = init?.body as URLSearchParams;
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
    expect(init?.headers).toEqual({ "content-type": "application/x-www-form-urlencoded" });
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "authorization_code",
      code: "one-use-code",
      client_id: GOOGLE_CLIENT_ID,
      client_secret: "google-client-secret",
      redirect_uri: "https://byus.test/api/auth/apple/reauth/callback/google",
    });
    expect(body.has("nonce")).toBe(false);
    expect(body.has("sid")).toBe(false);
  });

  it("verifies Apple and signs the exchanged client secret with the fixed Apple identity", async () => {
    const { fetchMock, result } = await verify("apple", await idToken("apple"));
    expect(result).toBe(providerSubjectHash("apple", APPLE_SUBJECT));

    const [url, init] = fetchMock.mock.calls[0];
    const body = init?.body as URLSearchParams;
    expect(url).toBe("https://appleid.apple.com/auth/token");
    expect(body.get("client_id")).toBe(APPLE_SERVICE_ID);
    expect(body.get("redirect_uri")).toBe("https://byus.test/api/auth/apple/reauth/callback/apple");
    expect(body.has("nonce")).toBe(false);
    expect(body.has("sid")).toBe(false);

    const clientSecret = body.get("client_secret");
    expect(clientSecret).toBeTruthy();
    const verified = await jwtVerify(clientSecret!, appleClientPublicKey, {
      algorithms: ["ES256"],
      issuer: APPLE_TEAM_ID,
      audience: "https://appleid.apple.com",
      subject: APPLE_SERVICE_ID,
      currentDate: NOW,
    });
    expect(verified.protectedHeader).toMatchObject({ alg: "ES256", kid: APPLE_KEY_ID });
    expect(verified.payload).toMatchObject({
      iss: APPLE_TEAM_ID,
      sub: APPLE_SERVICE_ID,
      aud: "https://appleid.apple.com",
      iat: NOW_SECONDS,
      exp: NOW_SECONDS + 300,
    });
  });

  it.each(["google", "apple"] as const)("builds a fixed %s authorization endpoint", (provider) => {
    const authorization = new URL(reauthenticationAuthorizationUrl({
      config,
      provider,
      state: "requested-state",
      nonce: "requested-nonce",
    }));
    expect(authorization.origin + authorization.pathname).toBe(provider === "apple"
      ? "https://appleid.apple.com/auth/authorize"
      : "https://accounts.google.com/o/oauth2/v2/auth");
    expect(authorization.searchParams.get("client_id")).toBe(provider === "apple"
      ? APPLE_SERVICE_ID
      : GOOGLE_CLIENT_ID);
    expect(authorization.searchParams.get("redirect_uri")).toBe(
      `https://byus.test/api/auth/apple/reauth/callback/${provider}`,
    );
    expect(authorization.searchParams.get("state")).toBe("requested-state");
    expect(authorization.searchParams.get("nonce")).toBe("requested-nonce");
  });

  it.each([
    ["wrong issuer", { iss: "https://attacker.test" }],
    ["wrong audience", { aud: "attacker-client" }],
    ["multiple audiences without azp", { aud: [GOOGLE_CLIENT_ID, "other-client"] }],
    ["wrong azp", { azp: "other-client" }],
    ["wrong subject", { sub: "different-google-subject" }],
    ["nonce mismatch", { nonce: "different-nonce" }],
    ["expired", { exp: NOW_SECONDS - 31 }],
    ["future iat", { iat: NOW_SECONDS + 31 }],
  ] satisfies ReadonlyArray<readonly [string, Partial<JWTPayload>]>)("rejects Google %s", async (_label, overrides) => {
    await expect(verify("google", await idToken("google", overrides))).rejects.toThrow();
  });

  it("accepts a multiple-audience token only with the expected authorized party", async () => {
    const token = await idToken("google", {
      aud: [GOOGLE_CLIENT_ID, "other-client"],
      azp: GOOGLE_CLIENT_ID,
    });
    await expect(verify("google", token)).resolves.toMatchObject({
      result: providerSubjectHash("google", GOOGLE_SUBJECT),
    });
  });

  it("rejects a token signed by the wrong RSA key", async () => {
    await expect(
      verify("google", await idToken("google", {}, otherPrivateKey)),
    ).rejects.toThrow();
  });

  it("rejects algorithms other than RS256", async () => {
    const secret = new TextEncoder().encode("long-test-only-hmac-key-material");
    const token = await new SignJWT(claims("google"))
      .setProtectedHeader({ alg: "HS256", kid: "idp-key" })
      .sign(secret);
    await expect(verify("google", token)).rejects.toThrow();
  });

  it("fails closed on token HTTP errors without parsing their body", async () => {
    const fetchMock = tokenFetch("provider-sensitive-body", 401);
    await expect(verify("google", "unused", fetchMock)).rejects.toThrow(
      "Provider reauthentication failed",
    );
  });

  it("bounds token responses by body size and id_token length", async () => {
    const oversizedBody = tokenFetch("unused", 200, { "content-length": "32769" });
    await expect(verify("google", "unused", oversizedBody)).rejects.toThrow("Request is too large");

    const oversizedToken = tokenFetch("x".repeat(16_385));
    await expect(verify("google", "unused", oversizedToken)).rejects.toThrow();
  });

  it.each([
    "http://byus.test",
    "https://byus.test/path",
    "https://user:password@byus.test",
    "https://byus.test/",
  ])("rejects redirect origin configuration %s", (origin) => {
    expect(() => loadReauthenticationProviderConfig({
      NODE_ENV: "test",
      NEXT_PUBLIC_APP_URL: origin,
      APPLE_REAUTH_GOOGLE_CLIENT_ID: GOOGLE_CLIENT_ID,
      APPLE_REAUTH_GOOGLE_CLIENT_SECRET: "google-client-secret",
      APPLE_REAUTH_PRIVATE_KEY: config.applePrivateKey,
    })).toThrow("Provider reauthentication configuration is incomplete");
  });
});
