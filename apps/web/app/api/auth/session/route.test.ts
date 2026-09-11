import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "../../../../features/auth/domain/auth-errors";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  sync: vi.fn(),
  reportRecoveryFailure: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("../../../../server/config/env", () => ({
  loadServerEnv: () => ({
    GIWA_CHAIN_ID: 91342,
    PRIVY_APP_ID: "privy-app",
    PRIVY_APP_SECRET: "privy-secret-sentinel",
    PRIVY_APP_ENVIRONMENT: "development",
    PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: false,
    PRIVY_APPLE_LOGIN_ENABLED: true,
    SUPABASE_URL: "https://database-secret-sentinel.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-secret-sentinel",
  }),
}));

vi.mock("../../../../server/auth/privy-node-verifier", () => ({
  createPrivyNodeSessionResolver: () => ({ resolve: mocks.resolve }),
}));

vi.mock("../../../../server/auth/supabase-session-sync-repository", () => ({
  createSupabaseSessionSyncRepository: () => ({ sync: mocks.sync }),
}));

vi.mock("../../../../features/reliability/client/request-deadline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../features/reliability/client/request-deadline")>();
  return { ...actual, reportRecoveryFailure: mocks.reportRecoveryFailure };
});

import { POST } from "./route";

const identity = {
  privyUserId: "did:privy:user",
  verifiedEmail: "fan@example.com",
  googleLinked: false,
};
const wallet = { chainId: 91342, address: "0x0000000000000000000000000000000000000001" };
const profile = { completed: true, nickname: "Fan12" };

function request(body: unknown = { locale: "ko" }) {
  return new Request("https://byus.test/api/auth/session", {
    method: "POST",
    headers: {
      authorization: "Bearer access-token-secret-sentinel",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => { resolve = onResolve; });
  return { promise, resolve };
}

beforeEach(() => {
  mocks.resolve.mockReset().mockResolvedValue({ identity, wallet });
  mocks.sync.mockReset().mockResolvedValue(profile);
  mocks.reportRecoveryFailure.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("POST /api/auth/session diagnostics", () => {
  it("preserves the successful session response and emits bounded timing", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ profile });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]).toEqual([
      "[auth/session] timing",
      expect.objectContaining({
        stage: "complete",
        outcome: "success",
        code: "OK",
        totalMs: expect.any(Number),
        privyMs: expect.any(Number),
        repositoryMs: expect.any(Number),
      }),
    ]);
    expect(JSON.stringify(info.mock.calls)).not.toContain("secret-sentinel");
  });

  it("preserves an AuthError response and logs only normalized metadata", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.resolve.mockRejectedValue(
      new AuthError("INVALID_WALLET", 422, "provider-message-secret-sentinel"),
    );

    const response = await POST(request());

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: { code: "INVALID_WALLET" } });
    expect(errorLog).toHaveBeenCalledWith(
      "[auth/session] synchronization failed",
      { name: "AuthError", code: "INVALID_WALLET" },
    );
    expect(info).toHaveBeenCalledWith(
      "[auth/session] timing",
      expect.objectContaining({
        stage: "privy_resolver",
        outcome: "failure",
        code: "INVALID_WALLET",
      }),
    );
    expect(JSON.stringify([...info.mock.calls, ...errorLog.mock.calls])).not.toContain("secret-sentinel");
  });

  it("reports the active repository stage at the outer timeout and ignores late success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pendingRepository = deferred<typeof profile>();
    mocks.sync.mockReturnValue(pendingRepository.promise);
    const responsePromise = POST(request());

    await vi.advanceTimersByTimeAsync(30_000);
    const response = await responsePromise;

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: { code: "SESSION_SYNC_FAILED" } });
    expect(info.mock.calls).toEqual([[
      "[auth/session] timing",
      {
        stage: "supabase_repository",
        outcome: "timeout",
        code: "OUTER_TIMEOUT",
        totalMs: 30_000,
        privyMs: 0,
        repositoryMs: 30_000,
      },
    ]]);
    const emittedSnapshot = JSON.stringify(info.mock.calls[0]);

    pendingRepository.resolve(profile);
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(info.mock.calls[0])).toBe(emittedSnapshot);
  });

  it("returns the original error response when recovery and error loggers throw", async () => {
    vi.spyOn(console, "info").mockImplementation(() => { throw new Error("info logger failed"); });
    vi.spyOn(console, "error").mockImplementation(() => { throw new Error("error logger failed"); });
    mocks.reportRecoveryFailure.mockImplementation(() => { throw new Error("recovery logger failed"); });
    mocks.resolve.mockRejectedValue(new AuthError("AUTHENTICATION_REQUIRED", 401, "private"));

    const response = await POST(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: "AUTHENTICATION_REQUIRED" } });
  });
});
