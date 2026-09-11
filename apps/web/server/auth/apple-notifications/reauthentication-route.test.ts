import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  privySessionHash,
  providerSubjectHash,
  sha256,
  type AppleLifecycleRepository,
  type ReauthenticationProvider,
  type VerifiedPrivySession,
} from "./apple-lifecycle";
import {
  completeReauthentication,
  startReauthentication,
  type ReauthenticationRouteDependencies,
} from "./reauthentication-route";

const ORIGIN = "https://byus.test";
const NOW = new Date("2026-09-10T10:00:00.000Z");
const PRIVY_USER_ID = "did:privy:user:user-1";
const SESSION_ID = "current-private-session-id";
const COOKIE_NAME = "__Host-byus-provider-reauth";

const session: VerifiedPrivySession = {
  privyUserId: PRIVY_USER_ID,
  sessionId: SESSION_ID,
  google: { subject: "google-subject-1", email: "fan@example.com" },
  apple: { subject: "apple-subject-1", email: "fan@privaterelay.appleid.com" },
};

const config = {
  origin: ORIGIN,
  googleClientId: "byus-test.apps.googleusercontent.com",
  googleClientSecret: "google-client-secret",
  applePrivateKey: "-----BEGIN PRIVATE KEY-----\ntest-only\n-----END PRIVATE KEY-----",
};

type VerifyCode = NonNullable<ReauthenticationRouteDependencies["verifyCode"]>;

type TestDependencies = ReauthenticationRouteDependencies & {
  repository: AppleLifecycleRepository & {
    call: ReturnType<typeof vi.fn>;
    check: ReturnType<typeof vi.fn>;
  };
  resolver: ReauthenticationRouteDependencies["resolver"] & {
    resolve: ReturnType<typeof vi.fn>;
    findProviderSubject: ReturnType<typeof vi.fn>;
  };
  verifyCode: VerifyCode & ReturnType<typeof vi.fn>;
  captured: { challenge?: Record<string, unknown> };
};

function dependencies(overrides: {
  access?: Partial<Awaited<ReturnType<AppleLifecycleRepository["check"]>>>;
  session?: VerifiedPrivySession;
  createResult?: boolean;
  completeResult?: boolean;
  currentSubject?: string | null;
  callFailure?: { operation: "create" | "read" | "complete"; message: string };
} = {}): TestDependencies {
  const activeSession = overrides.session ?? session;
  const captured: TestDependencies["captured"] = {};
  const check = vi.fn(async () => ({
    allowed: false,
    generation: 4,
    appleState: "revoked" as const,
    appleRecoveryAllowed: true,
    googleRecoveryAllowed: true,
    ...overrides.access,
  }));
  const call = vi.fn(async (name: string, parameters: Record<string, unknown>) => {
    const operation = name.startsWith("create_") ? "create"
      : name.startsWith("read_") ? "read"
        : "complete";
    if (overrides.callFailure?.operation === operation) {
      throw new Error(overrides.callFailure.message);
    }
    if (operation === "create") {
      captured.challenge = (parameters.p_challenge ?? {}) as Record<string, unknown>;
      return overrides.createResult ?? true;
    }
    if (operation === "read") {
      if (!captured.challenge) return null;
      const expectedState = captured.challenge.stateHash;
      const expectedCookie = captured.challenge.cookieHash;
      if (parameters.p_state_hash !== expectedState || parameters.p_cookie_hash !== expectedCookie) {
        return null;
      }
      return captured.challenge;
    }
    return overrides.completeResult ?? true;
  });
  const resolve = vi.fn(async () => activeSession);
  const findProviderSubject = vi.fn(async (
    _privyUserId: string,
    provider: ReauthenticationProvider,
  ) => overrides.currentSubject === undefined
    ? activeSession[provider]?.subject ?? null
    : overrides.currentSubject);
  const verifyCode = vi.fn<VerifyCode>(async (input) => input.expectedSubjectHash);

  return {
    config,
    repository: { call, check } as unknown as TestDependencies["repository"],
    resolver: { resolve, findProviderSubject },
    verifyCode,
    now: () => NOW,
    captured,
  };
}

function startRequest(provider: ReauthenticationProvider, overrides: RequestInit = {}): Request {
  const { headers, ...requestOverrides } = overrides;
  return new Request(`${ORIGIN}/api/auth/apple/reauth/start`, {
    ...requestOverrides,
    method: overrides.method ?? "POST",
    headers: {
      origin: ORIGIN,
      authorization: "Bearer verified-access-token",
      "content-type": "application/json",
      ...headers,
    },
    body: overrides.body ?? JSON.stringify({
      provider,
      returnTo: "/my?tab=account",
      locale: "ko",
      intent: "reserve",
      entity: "live-1",
    }),
  });
}

interface StartedChallenge {
  provider: ReauthenticationProvider;
  state: string;
  nonce: string;
  binding: string;
  cookie: string;
  authorizationUrl: URL;
}

async function start(
  provider: ReauthenticationProvider,
  deps: TestDependencies,
): Promise<StartedChallenge> {
  const response = await startReauthentication(startRequest(provider), deps);
  expect(response.status).toBe(200);
  const body = await response.json() as { authorizationUrl: string };
  const authorizationUrl = new URL(body.authorizationUrl);
  const state = authorizationUrl.searchParams.get("state")!;
  const nonce = authorizationUrl.searchParams.get("nonce")!;
  const cookie = response.headers.get("set-cookie")!;
  const binding = new RegExp(`${COOKIE_NAME}=([^;]+)`).exec(cookie)![1];
  return { provider, state, nonce, binding, cookie, authorizationUrl };
}

function callbackRequest(
  started: StartedChallenge,
  input: {
    provider?: ReauthenticationProvider;
    state?: string;
    code?: string;
    cookie?: string;
    duplicateState?: boolean;
    duplicateCode?: boolean;
    method?: string;
    error?: string;
  } = {},
): Request {
  const provider = input.provider ?? started.provider;
  const parameters = new URLSearchParams();
  if (input.state !== "") parameters.append("state", input.state ?? started.state);
  if (input.duplicateState) parameters.append("state", input.state ?? started.state);
  if (input.code !== "") parameters.append("code", input.code ?? "openid-code-secret");
  if (input.duplicateCode) parameters.append("code", input.code ?? "openid-code-secret");
  if (input.error) parameters.set("error", input.error);
  const cookie = input.cookie === undefined ? `${COOKIE_NAME}=${started.binding}` : input.cookie;

  if (provider === "apple") {
    return new Request(`${ORIGIN}/api/auth/apple/reauth/callback/apple`, {
      method: input.method ?? "POST",
      headers: {
        cookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: parameters,
    });
  }
  return new Request(
    `${ORIGIN}/api/auth/apple/reauth/callback/google?${parameters.toString()}`,
    { method: input.method ?? "GET", headers: { cookie } },
  );
}

describe("reauthentication start route", () => {
  it.each(["google", "apple"] as const)(
    "binds a %s challenge to state, nonce, cookie, session, and provider subject hashes",
    async (provider) => {
      const deps = dependencies();
      const started = await start(provider, deps);
      const challenge = deps.captured.challenge!;

      expect(started.state).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(started.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(started.binding).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(challenge).toMatchObject({
        stateHash: sha256(started.state),
        nonceHash: sha256(started.nonce),
        cookieHash: sha256(started.binding),
        privyUserId: PRIVY_USER_ID,
        sessionHash: privySessionHash(PRIVY_USER_ID, SESSION_ID),
        provider,
        providerSubjectHash: providerSubjectHash(provider, session[provider]!.subject),
        generation: 4,
        expiresAt: "2026-09-10T10:10:00.000Z",
      });
      expect(String(challenge.returnPath)).toContain("/login?");
      expect(String(challenge.returnPath)).toContain("returnTo=%2Fmy%3Ftab%3Daccount");
      expect(started.authorizationUrl.toString()).not.toContain(SESSION_ID);
      expect(deps.repository.call).toHaveBeenCalledWith(
        "create_apple_reauth_challenge",
        { p_challenge: challenge },
      );
    },
  );

  it("uses a host-only secure Lax cookie for Google and SameSite=None for Apple's form_post", async () => {
    const google = await start("google", dependencies());
    expect(google.cookie).toContain(`${COOKIE_NAME}=`);
    expect(google.cookie).toContain("Path=/");
    expect(google.cookie).toContain("HttpOnly");
    expect(google.cookie).toContain("Secure");
    expect(google.cookie).toContain("SameSite=Lax");
    expect(google.cookie).not.toMatch(/Domain=/iu);
    expect(google.authorizationUrl.searchParams.get("prompt")).toBe("select_account");

    const apple = await start("apple", dependencies());
    expect(apple.cookie).toContain("SameSite=None");
    expect(apple.authorizationUrl.searchParams.get("response_mode")).toBe("form_post");
  });

  it("rejects wrong origins and malformed or unverifiable bearer credentials generically", async () => {
    const wrongUrl = dependencies();
    const original = startRequest("google");
    expect((await startReauthentication(
      new Request("https://attacker.test/api/auth/apple/reauth/start", {
        method: "POST",
        headers: original.headers,
        body: await original.text(),
      }),
      wrongUrl,
    )).status).toBe(400);
    expect(wrongUrl.resolver.resolve).not.toHaveBeenCalled();

    const wrongHeader = dependencies();
    const wrongHeaderResponse = await startReauthentication(
      startRequest("google", { headers: { origin: "https://attacker.test" } }),
      wrongHeader,
    );
    expect(wrongHeaderResponse.status).toBe(400);
    expect(wrongHeader.resolver.resolve).not.toHaveBeenCalled();

    const missingBearer = dependencies();
    const missingRequest = startRequest("google", { headers: { authorization: "" } });
    const missingResponse = await startReauthentication(missingRequest, missingBearer);
    expect(missingResponse.status).toBe(401);
    expect(await missingResponse.json()).toEqual({ error: { code: "AUTHENTICATION_REQUIRED" } });

    const invalidBearer = dependencies();
    invalidBearer.resolver.resolve.mockRejectedValue(new Error("private token detail"));
    const invalidResponse = await startReauthentication(startRequest("google"), invalidBearer);
    expect(invalidResponse.status).toBe(503);
    expect(await invalidResponse.json()).toEqual({ error: { code: "REAUTHENTICATION_UNAVAILABLE" } });
  });

  it.each([
    ["google", { googleRecoveryAllowed: false }],
    ["apple", { appleRecoveryAllowed: false }],
  ] as const)("denies unavailable %s recovery before challenge creation", async (provider, access) => {
    const deps = dependencies({ access });
    const response = await startReauthentication(startRequest(provider), deps);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "REAUTHENTICATION_PROVIDER_UNAVAILABLE" } });
    expect(deps.repository.call).not.toHaveBeenCalled();
  });

  it("denies a provider absent from the verified current session", async () => {
    const deps = dependencies({ session: { ...session, google: null } });
    const response = await startReauthentication(startRequest("google"), deps);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "REAUTHENTICATION_PROVIDER_UNAVAILABLE" } });
    expect(deps.repository.call).not.toHaveBeenCalled();
  });

  it("returns a generic availability code for repository failure", async () => {
    const deps = dependencies({ callFailure: { operation: "create", message: "private DB detail" } });
    const response = await startReauthentication(startRequest("google"), deps);
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ error: { code: "REAUTHENTICATION_UNAVAILABLE" } });
    expect(body).not.toMatch(/private|DB detail/iu);
  });
});

describe("reauthentication callback route", () => {
  it.each(["google", "apple"] as const)(
    "completes a bound %s callback through query or form_post without leaking the code",
    async (provider) => {
      const deps = dependencies();
      const started = await start(provider, deps);
      const response = await completeReauthentication(
        callbackRequest(started),
        provider,
        deps,
      );

      expect(response.status).toBe(303);
      const location = response.headers.get("location")!;
      expect(location).toContain(`${ORIGIN}/login?`);
      expect(location).toContain("reauth=complete");
      expect(location).not.toMatch(/openid|code|token/iu);
      expect(response.headers.get("set-cookie")).toContain(`${COOKIE_NAME}=;`);
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
      expect(deps.verifyCode).toHaveBeenCalledWith({
        config,
        provider,
        code: "openid-code-secret",
        expectedNonceHash: sha256(started.nonce),
        expectedSubjectHash: providerSubjectHash(provider, session[provider]!.subject),
      });
      expect(deps.resolver.findProviderSubject).toHaveBeenCalledWith(PRIVY_USER_ID, provider);
      expect(deps.repository.call).toHaveBeenLastCalledWith(
        "complete_apple_reauthentication",
        {
          p_state_hash: sha256(started.state),
          p_cookie_hash: sha256(started.binding),
          p_provider_subject_hash: providerSubjectHash(provider, session[provider]!.subject),
        },
      );
    },
  );

  it.each([
    ["missing state", { state: "" }],
    ["malformed state", { state: "short" }],
    ["wrong state", { state: "s".repeat(43) }],
    ["missing cookie", { cookie: "" }],
    ["wrong cookie", { cookie: `${COOKIE_NAME}=${"c".repeat(43)}` }],
    ["duplicate cookie", { cookie: `${COOKIE_NAME}=${"c".repeat(43)}; ${COOKIE_NAME}=${"d".repeat(43)}` }],
    ["duplicate state", { duplicateState: true }],
  ] as const)("does not verify a code before recovering from %s binding", async (_label, input) => {
    const deps = dependencies();
    const started = await start("google", deps);
    const response = await completeReauthentication(
      callbackRequest(started, input),
      "google",
      deps,
    );
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe(ORIGIN);
    expect(location.pathname).toBe("/login");
    expect([...location.searchParams.entries()]).toEqual([
      ["locale", "ko"],
      ["reauth", "failed"],
    ]);
    expect(response.headers.get("set-cookie")).toContain(`${COOKIE_NAME}=;`);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(deps.verifyCode).not.toHaveBeenCalled();
    expect(deps.repository.call).not.toHaveBeenCalledWith(
      "complete_apple_reauthentication",
      expect.anything(),
    );
  });

  it("recovers an Apple form_post with a missing browser cookie without trusting callback data", async () => {
    const deps = dependencies();
    const started = await start("apple", deps);
    const response = await completeReauthentication(
      callbackRequest(started, { cookie: "" }),
      "apple",
      deps,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?locale=ko&reauth=failed`);
    expect(response.headers.get("set-cookie")).toContain(`${COOKIE_NAME}=;`);
    expect(response.headers.get("set-cookie")).toContain("SameSite=None");
    expect(deps.verifyCode).not.toHaveBeenCalled();
    expect(deps.repository.call).not.toHaveBeenCalledWith(
      "complete_apple_reauthentication",
      expect.anything(),
    );
  });

  it("rejects provider and method mismatches before code verification", async () => {
    const deps = dependencies();
    const started = await start("google", deps);

    const wrongProvider = await completeReauthentication(
      callbackRequest(started, { provider: "apple" }),
      "apple",
      deps,
    );
    expect(wrongProvider.status).toBe(400);
    expect(wrongProvider.headers.get("location")).toBeNull();
    expect(deps.verifyCode).not.toHaveBeenCalled();

    const wrongMethod = await completeReauthentication(
      callbackRequest(started, { method: "POST" }),
      "google",
      deps,
    );
    expect(wrongMethod.status).toBe(400);
    expect(wrongMethod.headers.get("location")).toBeNull();
    expect(deps.verifyCode).not.toHaveBeenCalled();

    const unknownProvider = await completeReauthentication(
      callbackRequest(started),
      "github",
      deps,
    );
    expect(unknownProvider.status).toBe(400);
    expect(unknownProvider.headers.get("location")).toBeNull();
    expect(deps.verifyCode).not.toHaveBeenCalled();

    const appleDeps = dependencies();
    const appleStarted = await start("apple", appleDeps);
    const wrongContentType = await completeReauthentication(
      new Request(`${ORIGIN}/api/auth/apple/reauth/callback/apple`, {
        method: "POST",
        headers: {
          cookie: `${COOKIE_NAME}=${appleStarted.binding}`,
          "content-type": "text/plain",
        },
        body: new URLSearchParams({ state: appleStarted.state, code: "code" }).toString(),
      }),
      "apple",
      appleDeps,
    );
    expect(wrongContentType.status).toBe(400);
    expect(wrongContentType.headers.get("location")).toBeNull();
    expect(appleDeps.verifyCode).not.toHaveBeenCalled();
  });

  it("rejects a callback on the wrong origin instead of redirecting it", async () => {
    const deps = dependencies();
    const started = await start("google", deps);
    const parameters = new URLSearchParams({ state: started.state, code: "openid-code-secret" });
    const response = await completeReauthentication(
      new Request(`https://attacker.test/api/auth/apple/reauth/callback/google?${parameters}`, {
        headers: { cookie: `${COOKIE_NAME}=${started.binding}` },
      }),
      "google",
      deps,
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(deps.repository.call).not.toHaveBeenCalledWith(
      "read_apple_reauth_challenge",
      expect.anything(),
    );
    expect(deps.verifyCode).not.toHaveBeenCalled();
  });

  it.each([
    ["missing code", { code: "" }],
    ["duplicate code", { duplicateCode: true }],
    ["provider error", { error: "access_denied" }],
  ] as const)("fails a validated challenge with %s and no verification", async (_label, input) => {
    const deps = dependencies();
    const started = await start("google", deps);
    const response = await completeReauthentication(callbackRequest(started, input), "google", deps);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("reauth=failed");
    expect(deps.verifyCode).not.toHaveBeenCalled();
  });

  it.each([
    ["unlinked", null],
    ["changed", "different-google-subject"],
  ] as const)("denies a currently %s provider after token verification", async (_label, currentSubject) => {
    const deps = dependencies({ currentSubject });
    const started = await start("google", deps);
    const response = await completeReauthentication(callbackRequest(started), "google", deps);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("reauth=failed");
    expect(deps.verifyCode).toHaveBeenCalledOnce();
    expect(deps.repository.call).not.toHaveBeenCalledWith(
      "complete_apple_reauthentication",
      expect.anything(),
    );
  });

  it("fails closed when atomic completion reports a generation or replay race", async () => {
    const deps = dependencies({ completeResult: false });
    const started = await start("apple", deps);
    const response = await completeReauthentication(callbackRequest(started), "apple", deps);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("reauth=failed");
    expect(response.headers.get("location")).not.toContain("reauth=complete");
  });

  it("maps repository read and completion failures to generic callback results", async () => {
    const readDeps = dependencies({ callFailure: { operation: "read", message: "private read detail" } });
    const readStarted = await start("google", readDeps);
    const readResponse = await completeReauthentication(callbackRequest(readStarted), "google", readDeps);
    expect(readResponse.status).toBe(303);
    const readBody = await readResponse.text();
    expect(readResponse.headers.get("location")).toBe(`${ORIGIN}/login?locale=ko&reauth=failed`);
    expect(readResponse.headers.get("set-cookie")).toContain(`${COOKIE_NAME}=;`);
    expect(readBody).toBe("");
    expect(readBody).not.toMatch(/private|read detail/iu);
    expect(readDeps.verifyCode).not.toHaveBeenCalled();

    const completeDeps = dependencies({ callFailure: { operation: "complete", message: "private write detail" } });
    const completeStarted = await start("apple", completeDeps);
    const completeResponse = await completeReauthentication(
      callbackRequest(completeStarted),
      "apple",
      completeDeps,
    );
    expect(completeResponse.status).toBe(303);
    expect(completeResponse.headers.get("location")).toContain("reauth=failed");
    expect(completeResponse.headers.get("location")).not.toMatch(/private|write detail/iu);
  });
});
