import "server-only";

import { randomBytes } from "node:crypto";
import { z } from "zod";

import {
  appendLoginContext, sanitizeAuthIntentId, sanitizeEntity, sanitizeIntent,
  sanitizeLocale, sanitizeReturnTo,
} from "../../../components/login-intent";
import {
  AppleLifecycleRepository, privySessionHash, providerSubjectHash, sha256,
  type ReauthenticationProvider, type VerifiedPrivySession,
} from "./apple-lifecycle";
import {
  boundedText, reauthenticationAuthorizationUrl, verifyReauthenticationCode,
  type ReauthenticationProviderConfig,
} from "./reauthentication-provider";

const COOKIE_NAME = "__Host-byus-provider-reauth";
const opaqueToken = /^[A-Za-z0-9_-]{43}$/;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const startSchema = z.object({
  provider: z.enum(["google", "apple"]),
  returnTo: z.string().max(1024).optional(),
  locale: z.enum(["ko", "en"]).optional(),
  intent: z.string().max(100).optional(),
  entity: z.string().max(200).nullable().optional(),
  authIntent: z.string().max(200).nullable().optional(),
}).strict();
const challengeSchema = z.object({
  nonceHash: hash,
  privyUserId: z.string().min(1).max(256),
  sessionHash: hash,
  provider: z.enum(["google", "apple"]),
  providerSubjectHash: hash,
  generation: z.number().int().nonnegative(),
  returnPath: z.string().max(2048).default("/login"),
});

export interface ReauthenticationRouteDependencies {
  config: ReauthenticationProviderConfig;
  repository: AppleLifecycleRepository;
  resolver: {
    resolve(token: string): Promise<VerifiedPrivySession>;
    findProviderSubject(privyUserId: string, provider: ReauthenticationProvider): Promise<string | null>;
  };
  verifyCode?: typeof verifyReauthenticationCode;
  now?: () => Date;
}

function headers(): Headers {
  return new Headers({
    "cache-control": "no-store", "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
}

function cookie(value: string, provider: ReauthenticationProvider, maxAge = 600): string {
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=${provider === "apple" ? "None" : "Lax"}`;
}

function readCookie(request: Request): string | null {
  const values = (request.headers.get("cookie") ?? "").split(";")
    .map((value) => value.trim()).filter((value) => value.startsWith(`${COOKIE_NAME}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(COOKIE_NAME.length + 1);
  return opaqueToken.test(value) ? value : null;
}

function safeLoginPath(path: string): string {
  const url = new URL(path, "https://byus.invalid");
  if (url.origin !== "https://byus.invalid" || url.pathname !== "/login" || url.hash) return "/login";
  return url.pathname + url.search;
}

function invalidCallbackResponse(responseHeaders: Headers): Response {
  return Response.json(
    { error: { code: "INVALID_REAUTHENTICATION_CALLBACK" } },
    { status: 400, headers: responseHeaders },
  );
}

function callbackFailureResponse(input: {
  responseHeaders: Headers;
  origin: string;
  provider: ReauthenticationProvider;
  returnPath?: string;
}): Response {
  const destination = new URL(
    input.returnPath ? safeLoginPath(input.returnPath) : "/login",
    input.origin,
  );
  if (!input.returnPath) destination.searchParams.set("locale", sanitizeLocale(null));
  destination.searchParams.set("reauth", "failed");
  input.responseHeaders.set("set-cookie", cookie("", input.provider, 0));
  input.responseHeaders.set("location", destination.toString());
  return new Response(null, { status: 303, headers: input.responseHeaders });
}

export async function startReauthentication(request: Request, dependencies: ReauthenticationRouteDependencies): Promise<Response> {
  const responseHeaders = headers();
  try {
    if (new URL(request.url).origin !== dependencies.config.origin
      || request.headers.get("origin") !== dependencies.config.origin
      || !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return Response.json({ error: { code: "INVALID_REAUTHENTICATION_REQUEST" } }, { status: 400, headers: responseHeaders });
    }
    const bearer = /^Bearer[ \t]+([^\s]+)$/i.exec(request.headers.get("authorization")?.trim() ?? "");
    if (!bearer) return Response.json({ error: { code: "AUTHENTICATION_REQUIRED" } }, { status: 401, headers: responseHeaders });
    const input = startSchema.parse(JSON.parse(await boundedText(request, 4096)));
    const session = await dependencies.resolver.resolve(bearer[1]);
    const access = await dependencies.repository.check(session);
    const account = session[input.provider];
    const available = input.provider === "apple" ? access.appleRecoveryAllowed : access.googleRecoveryAllowed;
    if (!account || !available) {
      return Response.json({ error: { code: "REAUTHENTICATION_PROVIDER_UNAVAILABLE" } }, { status: 403, headers: responseHeaders });
    }
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const browserBinding = randomBytes(32).toString("base64url");
    const returnPath = appendLoginContext("/login", {
      returnTo: sanitizeReturnTo(input.returnTo), locale: sanitizeLocale(input.locale ?? null),
      intent: sanitizeIntent(input.intent ?? null), entity: sanitizeEntity(input.entity),
      authIntent: sanitizeAuthIntentId(input.authIntent),
    });
    const created = await dependencies.repository.call("create_apple_reauth_challenge", {
      p_challenge: {
        stateHash: sha256(state), cookieHash: sha256(browserBinding), nonceHash: sha256(nonce),
        privyUserId: session.privyUserId,
        sessionHash: privySessionHash(session.privyUserId, session.sessionId),
        provider: input.provider, providerSubjectHash: providerSubjectHash(input.provider, account.subject),
        generation: access.generation, returnPath,
        expiresAt: new Date((dependencies.now?.() ?? new Date()).getTime() + 600_000).toISOString(),
      },
    });
    if (created !== true) throw new Error("Reauthentication challenge could not be created");
    responseHeaders.set("set-cookie", cookie(browserBinding, input.provider));
    return Response.json({ authorizationUrl: reauthenticationAuthorizationUrl({
      config: dependencies.config, provider: input.provider, state, nonce,
    }) }, { status: 200, headers: responseHeaders });
  } catch {
    return Response.json({ error: { code: "REAUTHENTICATION_UNAVAILABLE" } }, { status: 503, headers: responseHeaders });
  }
}

export async function completeReauthentication(
  request: Request, provider: string, dependencies: ReauthenticationRouteDependencies,
): Promise<Response> {
  const responseHeaders = headers();
  let requestOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    return invalidCallbackResponse(responseHeaders);
  }
  if ((provider !== "apple" && provider !== "google")
    || requestOrigin !== dependencies.config.origin
    || (provider === "apple" && request.method !== "POST")
    || (provider === "google" && request.method !== "GET")
    || (provider === "apple" && !request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded"))) {
    return invalidCallbackResponse(responseHeaders);
  }
  let validatedChallenge: z.infer<typeof challengeSchema> | null = null;
  try {
    const parameters = provider === "apple"
      ? new URLSearchParams(await boundedText(request, 8192))
      : new URL(request.url).searchParams;
    const state = parameters.get("state");
    const browserBinding = readCookie(request);
    if (!state || !opaqueToken.test(state) || parameters.getAll("state").length !== 1 || !browserBinding) {
      throw new Error("Invalid callback binding");
    }
    const row = await dependencies.repository.call("read_apple_reauth_challenge", {
      p_state_hash: sha256(state), p_cookie_hash: sha256(browserBinding),
    });
    const challenge = challengeSchema.parse(row);
    if (challenge.provider !== provider) return invalidCallbackResponse(responseHeaders);
    validatedChallenge = challenge;
    const code = parameters.get("code");
    if (parameters.has("error") || !code || code.length > 4096 || parameters.getAll("code").length !== 1) {
      throw new Error("Provider authorization was not completed");
    }
    const subjectHash = await (dependencies.verifyCode ?? verifyReauthenticationCode)({
      config: dependencies.config, provider, code,
      expectedNonceHash: challenge.nonceHash, expectedSubjectHash: challenge.providerSubjectHash,
    });
    const currentSubject = await dependencies.resolver.findProviderSubject(challenge.privyUserId, provider);
    if (!currentSubject || providerSubjectHash(provider, currentSubject) !== subjectHash) {
      throw new Error("The provider account has changed");
    }
    const completed = await dependencies.repository.call("complete_apple_reauthentication", {
      p_state_hash: sha256(state), p_cookie_hash: sha256(browserBinding), p_provider_subject_hash: subjectHash,
    });
    if (completed !== true) throw new Error("Reauthentication challenge is no longer valid");
    const destination = new URL(safeLoginPath(challenge.returnPath), dependencies.config.origin);
    destination.searchParams.set("reauth", "complete");
    responseHeaders.set("set-cookie", cookie("", provider, 0));
    responseHeaders.set("location", destination.toString());
    return new Response(null, { status: 303, headers: responseHeaders });
  } catch {
    return callbackFailureResponse({
      responseHeaders,
      origin: dependencies.config.origin,
      provider: validatedChallenge?.provider ?? provider,
      returnPath: validatedChallenge?.returnPath,
    });
  }
}
