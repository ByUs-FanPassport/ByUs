import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuthError } from "../../features/auth/domain/auth-errors";
import { authorizeAdminSession, type AdminSessionRepository } from "./admin-session-gate";

function repository(overrides: Partial<AdminSessionRepository> = {}): AdminSessionRepository {
  return {
    findUserByPrivyId: vi.fn().mockResolvedValue({
      id: "user-1",
      privyUserId: "did:privy:admin",
      verifiedEmail: "biz@sallylab.io",
      status: "active",
    }),
    findActiveAdminByEmail: vi.fn().mockResolvedValue({
      id: "allow-1",
      email: "biz@sallylab.io",
      role: "admin",
      active: true,
    }),
    appendAuthorizationAudit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const verifier = {
  verify: vi.fn().mockResolvedValue({
    privyUserId: "did:privy:admin",
    verifiedEmail: " Biz@SallyLab.IO ",
  }),
};

describe("authorizeAdminSession", () => {
  it("verifies the bearer token, active user and allowlist before returning a session", async () => {
    const repo = repository();

    await expect(
      authorizeAdminSession({
        authorization: "Bearer access-token",
        correlationId: "4d5a7d2c-fc5c-42ea-816a-460b1c4d216e",
        verifier,
        repository: repo,
      }),
    ).resolves.toEqual({ email: "biz@sallylab.io", role: "admin" });

    expect(repo.findUserByPrivyId).toHaveBeenCalledWith("did:privy:admin");
    expect(repo.findActiveAdminByEmail).toHaveBeenCalledWith("biz@sallylab.io");
    expect(repo.appendAuthorizationAudit).toHaveBeenCalledWith({
      actorAppUserId: "user-1",
      actorAdminAllowlistId: "allow-1",
      correlationId: "4d5a7d2c-fc5c-42ea-816a-460b1c4d216e",
      action: "admin.session.authorized",
      summary: { outcome: "authorized", role: "admin" },
    });
  });

  it.each([
    ["missing bearer", "", undefined, 401],
    ["unknown app user", "Bearer token", null, 403],
    [
      "disabled app user",
      "Bearer token",
      { id: "user-1", privyUserId: "did:privy:admin", verifiedEmail: "biz@sallylab.io", status: "disabled" },
      403,
    ],
    [
      "stale app-user email",
      "Bearer token",
      { id: "user-1", privyUserId: "did:privy:admin", verifiedEmail: "other@sallylab.io", status: "active" },
      403,
    ],
  ] as const)("denies %s without producing an admin session", async (_label, authorization, user, status) => {
    const repo = repository(
      user === undefined ? {} : { findUserByPrivyId: vi.fn().mockResolvedValue(user) },
    );

    const error = await authorizeAdminSession({
      authorization,
      correlationId: "correlation",
      verifier,
      repository: repo,
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ status });
    expect(repo.findActiveAdminByEmail).not.toHaveBeenCalled();
    expect(repo.appendAuthorizationAudit).not.toHaveBeenCalled();
  });

  it("fails closed when the allowlist is absent or inactive", async () => {
    for (const entry of [null, { id: "allow-1", email: "biz@sallylab.io", role: "admin" as const, active: false }]) {
      const repo = repository({ findActiveAdminByEmail: vi.fn().mockResolvedValue(entry) });
      await expect(
        authorizeAdminSession({
          authorization: "Bearer token",
          correlationId: "correlation",
          verifier,
          repository: repo,
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(repo.appendAuthorizationAudit).not.toHaveBeenCalled();
    }
  });

  it("fails closed rather than returning a session when the redacted audit cannot be appended", async () => {
    const repo = repository({
      appendAuthorizationAudit: vi.fn().mockRejectedValue(new Error("audit unavailable")),
    });

    await expect(
      authorizeAdminSession({
        authorization: "Bearer token",
        correlationId: "correlation",
        verifier,
        repository: repo,
      }),
    ).rejects.toThrow("audit unavailable");
  });
});
