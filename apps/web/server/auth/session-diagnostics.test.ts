import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "../../features/auth/domain/auth-errors";
import {
  RequestTimeoutError,
  withOperationDeadline,
} from "../../features/reliability/client/request-deadline";
import {
  createSessionTimingDiagnostics,
  normalizedSessionError,
} from "./session-diagnostics";
import { syncAuthenticatedSession } from "./session-sync";

const identity = {
  privyUserId: "did:privy:user",
  verifiedEmail: "fan@example.com",
  googleLinked: false,
};
const wallet = { chainId: 91342, address: "0x0000000000000000000000000000000000000001" as const };
const profile = { completed: true, nickname: "Fan12" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("session timing diagnostics", () => {
  it("normalizes free-form error names while preserving known AuthError codes", () => {
    const upstream = new Error("upstream-message-secret-sentinel");
    upstream.name = "ProviderError-secret-sentinel";

    expect(normalizedSessionError(upstream)).toEqual({
      name: "Error",
      code: "SESSION_SYNC_FAILED",
    });
    expect(normalizedSessionError(
      new AuthError("APPLE_REAUTHENTICATION_REQUIRED", 403, "auth-message-secret-sentinel"),
    )).toEqual({
      name: "AuthError",
      code: "APPLE_REAUTHENTICATION_REQUIRED",
    });
    expect(JSON.stringify(normalizedSessionError(upstream))).not.toContain("secret-sentinel");
  });

  it("reports bounded Privy, repository, and total timing on success", async () => {
    let clock = 0;
    const events: unknown[] = [];
    const diagnostics = createSessionTimingDiagnostics({
      timeoutMs: 30_000,
      now: () => clock,
      logger: (_message, event) => events.push(event),
    });
    const resolver = diagnostics.wrapResolver({ resolve: async () => {
      clock = 10;
      return { identity, wallet };
    } });
    const repository = diagnostics.wrapRepository({ sync: async () => {
      clock = 25;
      return profile;
    } });

    await expect(syncAuthenticatedSession({
      authorization: "Bearer access-token",
      chainId: 91342,
      preferredLocale: "ko",
      resolver,
      repository,
    })).resolves.toEqual(profile);
    diagnostics.success();

    expect(events).toEqual([{
      stage: "complete",
      outcome: "success",
      code: "OK",
      totalMs: 25,
      privyMs: 10,
      repositoryMs: 15,
    }]);
  });

  it("reports a sanitized provider failure without leaking its message", async () => {
    const secret = "provider-secret-sentinel";
    const events: unknown[] = [];
    const diagnostics = createSessionTimingDiagnostics({
      timeoutMs: 30_000,
      logger: (_message, event) => events.push(event),
    });

    await expect(diagnostics.wrapResolver({
      resolve: async () => { throw new Error(secret); },
    }).resolve("token-secret-sentinel", 91342)).rejects.toThrow(secret);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      stage: "privy_resolver",
      outcome: "failure",
      code: "SESSION_SYNC_FAILED",
    });
    expect(JSON.stringify(events)).not.toContain("secret-sentinel");
  });

  it("reports a repository failure using only an allowlisted AuthError code", async () => {
    const events: unknown[] = [];
    const diagnostics = createSessionTimingDiagnostics({
      timeoutMs: 30_000,
      logger: (_message, event) => events.push(event),
    });
    const repository = diagnostics.wrapRepository({
      sync: async () => { throw new AuthError("INVALID_WALLET", 422, "database-secret-sentinel"); },
    });

    await expect(repository.sync(identity, wallet, "ko")).rejects.toThrow("database-secret-sentinel");
    diagnostics.failure(new Error("duplicate-secret-sentinel"));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      stage: "supabase_repository",
      outcome: "failure",
      code: "INVALID_WALLET",
    });
    expect(JSON.stringify(events)).not.toContain("secret-sentinel");
  });

  it("distinguishes an inner repository deadline from the outer request deadline", async () => {
    const events: unknown[] = [];
    const diagnostics = createSessionTimingDiagnostics({
      timeoutMs: 30_000,
      logger: (_message, event) => events.push(event),
    });
    const repository = diagnostics.wrapRepository({
      sync: async () => { throw new RequestTimeoutError(20_000); },
    });

    await expect(repository.sync(identity, wallet, "ko")).rejects.toMatchObject({
      name: "RequestTimeoutError",
      timeoutMs: 20_000,
    });
    diagnostics.failure(new RequestTimeoutError(30_000));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      stage: "supabase_repository",
      outcome: "timeout",
      code: "STAGE_TIMEOUT",
    });
    expect(normalizedSessionError(new RequestTimeoutError(20_000), 30_000)).toEqual({
      name: "RequestTimeoutError",
      code: "STAGE_TIMEOUT",
    });
    expect(normalizedSessionError(new RequestTimeoutError(30_000), 30_000)).toEqual({
      name: "RequestTimeoutError",
      code: "OUTER_TIMEOUT",
    });
  });

  it("seals the active stage at the outer timeout and ignores late completion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const events: unknown[] = [];
    const pendingRepository = deferred<typeof profile>();
    const diagnostics = createSessionTimingDiagnostics({
      timeoutMs: 30_000,
      logger: (_message, event) => events.push(event),
    });
    const operation = syncAuthenticatedSession({
      authorization: "Bearer access-token",
      chainId: 91342,
      preferredLocale: "ko",
      resolver: diagnostics.wrapResolver({ resolve: async () => ({ identity, wallet }) }),
      repository: diagnostics.wrapRepository({ sync: () => pendingRepository.promise }),
    });
    const deadline = withOperationDeadline(operation, 30_000).catch((error) => {
      diagnostics.failure(error);
      throw error;
    });

    const deadlineExpectation = expect(deadline).rejects.toMatchObject({ name: "RequestTimeoutError" });
    await vi.advanceTimersByTimeAsync(30_000);
    await deadlineExpectation;
    expect(events).toEqual([{
      stage: "supabase_repository",
      outcome: "timeout",
      code: "OUTER_TIMEOUT",
      totalMs: 30_000,
      privyMs: 0,
      repositoryMs: 30_000,
    }]);
    const emittedSnapshot = JSON.stringify(events[0]);

    pendingRepository.resolve(profile);
    await operation;
    diagnostics.success();

    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0])).toBe(emittedSnapshot);
  });

  it("does not let a throwing logger change a successful login", async () => {
    const diagnostics = createSessionTimingDiagnostics({
      timeoutMs: 30_000,
      logger: () => { throw new Error("logger unavailable"); },
    });
    const resolver = diagnostics.wrapResolver({ resolve: async () => ({ identity, wallet }) });
    const repository = diagnostics.wrapRepository({ sync: async () => profile });

    await expect(syncAuthenticatedSession({
      authorization: "Bearer access-token",
      chainId: 91342,
      preferredLocale: "ko",
      resolver,
      repository,
    })).resolves.toEqual(profile);
    expect(() => diagnostics.success()).not.toThrow();
  });
});
