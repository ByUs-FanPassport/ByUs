import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuthError } from "../../features/auth/domain/auth-errors";
import {
  authorizeFanRequest,
  FanAuthUnavailableError,
  type FanAuthRepository,
} from "./fan-auth-gate";

function repository(
  user: Awaited<ReturnType<FanAuthRepository["findUserByPrivyId"]>> = {
    id: "user-1",
    privyUserId: "did:privy:fan",
    verifiedEmail: "fan@example.com",
    status: "active",
  },
): FanAuthRepository {
  return {
    findUserByPrivyId: vi.fn().mockResolvedValue(user),
  };
}

function verifier() {
  return {
    verify: vi.fn().mockResolvedValue({
      privyUserId: "  did:privy:fan  ",
      verifiedEmail: "fan@example.com",
    }),
  };
}

describe("authorizeFanRequest", () => {
  it("verifies the token before looking up the active user by canonical Privy subject", async () => {
    const accessVerifier = verifier();
    const repo = repository();

    await expect(
      authorizeFanRequest({
        authorization: "Bearer access-token",
        verifier: accessVerifier,
        repository: repo,
      }),
    ).resolves.toStrictEqual({ appUserId: "user-1" });

    expect(accessVerifier.verify).toHaveBeenCalledWith("access-token");
    expect(repo.findUserByPrivyId).toHaveBeenCalledWith("did:privy:fan");
    expect(accessVerifier.verify.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(repo.findUserByPrivyId).mock.invocationCallOrder[0],
    );
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["whitespace only", "   "],
    ["missing scheme", "access-token"],
    ["missing token", "Bearer "],
    ["token with whitespace", "Bearer access token"],
  ] as const)("rejects a %s Authorization header without dependencies", async (_label, authorization) => {
    const accessVerifier = verifier();
    const repo = repository();

    const error = await authorizeFanRequest({
      authorization,
      verifier: accessVerifier,
      repository: repo,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
      status: 401,
      message: "Authentication is required",
    });
    expect(accessVerifier.verify).not.toHaveBeenCalled();
    expect(repo.findUserByPrivyId).not.toHaveBeenCalled();
  });

  it.each([
    ["case-insensitive scheme", "bearer access-token"],
    ["tab separator", "Bearer\taccess-token"],
    ["multiple separators", "Bearer \t access-token"],
    ["outer whitespace", " \tBearer access-token\t "],
  ] as const)("accepts canonical %s syntax", async (_label, authorization) => {
    const accessVerifier = verifier();

    await expect(
      authorizeFanRequest({
        authorization,
        verifier: accessVerifier,
        repository: repository(),
      }),
    ).resolves.toStrictEqual({ appUserId: "user-1" });

    expect(accessVerifier.verify).toHaveBeenCalledWith("access-token");
  });

  it("maps verifier failures to an opaque authentication error", async () => {
    const accessVerifier = {
      verify: vi.fn().mockRejectedValue(new Error("provider says token abc expired for user 42")),
    };
    const repo = repository();

    const error = await authorizeFanRequest({
      authorization: "Bearer access-token",
      verifier: accessVerifier,
      repository: repo,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
      status: 401,
      message: "Authentication is required",
    });
    expect(error).not.toHaveProperty("cause");
    expect(String(error)).not.toContain("provider");
    expect(String(error)).not.toContain("abc");
    expect(repo.findUserByPrivyId).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown", null],
    [
      "inactive",
      {
        id: "user-1",
        privyUserId: "did:privy:fan",
        verifiedEmail: "fan@example.com",
        status: "disabled" as const,
      },
    ],
  ])("returns the same opaque forbidden error for an %s user", async (_label, user) => {
    const accessVerifier = verifier();
    const repo = repository(user);

    const error = await authorizeFanRequest({
      authorization: "Bearer access-token",
      verifier: accessVerifier,
      repository: repo,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
      status: 403,
      message: "Fan access is unavailable",
    });
  });

  it("maps repository failures to an opaque service-unavailable error", async () => {
    const repo: FanAuthRepository = {
      findUserByPrivyId: vi
        .fn()
        .mockRejectedValue(
          new Error(
            'relation "private.app_users" missing while selecting did:privy:secret-subject',
          ),
        ),
    };

    const error = await authorizeFanRequest({
      authorization: "Bearer access-token",
      verifier: verifier(),
      repository: repo,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(FanAuthUnavailableError);
    expect(error).toMatchObject({
      code: "FAN_AUTH_UNAVAILABLE",
      status: 503,
      message: "Fan authentication is temporarily unavailable",
    });
    expect(error).not.toHaveProperty("cause");
    expect(String(error)).not.toContain("relation");
    expect(String(error)).not.toContain("app_users");
    expect(String(error)).not.toContain("secret-subject");
  });

  it("returns only the app-user ID and does not expose identity or repository fields", async () => {
    const result = await authorizeFanRequest({
      authorization: "Bearer access-token",
      verifier: verifier(),
      repository: repository(),
    });

    expect(Object.keys(result)).toStrictEqual(["appUserId"]);
    expect(result).toStrictEqual({ appUserId: "user-1" });
    expect(result).not.toHaveProperty("privyUserId");
    expect(result).not.toHaveProperty("verifiedEmail");
    expect(result).not.toHaveProperty("status");
  });
});
