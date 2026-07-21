import { describe, expect, it } from "vitest";

import { authorizeAdmin } from "./admin-authorization";
import { AuthError } from "./auth-errors";

function expectAuthError(run: () => unknown, code: AuthError["code"], status: AuthError["status"]): void {
  try {
    run();
    throw new Error("Expected an AuthError");
  } catch (error) {
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ code, status });
  }
}

describe("admin authorization", () => {
  it("matches a verified email case-insensitively and returns the active role", () => {
    expect(
      authorizeAdmin(
        { privyUserId: "did:privy:admin", verifiedEmail: " Biz@SallyLab.IO " },
        { id: "allow-1", email: "biz@sallylab.io", role: "admin", active: true },
      ),
    ).toEqual({
      allowlistId: "allow-1",
      privyUserId: "did:privy:admin",
      email: "biz@sallylab.io",
      role: "admin",
    });
  });

  it.each([
    [null, "ADMIN_NOT_ALLOWLISTED"],
    [{ id: "allow-1", email: "biz@sallylab.io", role: "admin", active: false }, "ADMIN_DISABLED"],
    [{ id: "allow-1", email: "other@sallylab.io", role: "admin", active: true }, "ADMIN_EMAIL_MISMATCH"],
  ] as const)("denies missing, removed, disabled, or mismatched entries", (entry, code) => {
    expectAuthError(
      () =>
      authorizeAdmin(
        { privyUserId: "did:privy:admin", verifiedEmail: "biz@sallylab.io" },
        entry,
      ),
      code,
      403,
    );
  });

  it("distinguishes an absent authenticated identity as 401", () => {
    expectAuthError(() => authorizeAdmin(null, null), "AUTHENTICATION_REQUIRED", 401);
  });
});
