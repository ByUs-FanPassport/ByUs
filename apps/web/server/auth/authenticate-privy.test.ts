import { describe, expect, it, vi } from "vitest";

import { AuthError } from "../../features/auth/domain/auth-errors";
import { authenticatePrivyAccessToken } from "./authenticate-privy";

describe("authenticatePrivyAccessToken", () => {
  it("requires a bearer token before calling Privy", async () => {
    const verify = vi.fn();

    await expect(authenticatePrivyAccessToken(" ", { verify })).rejects.toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
      status: 401,
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it("returns a canonical identity only after the verifier succeeds", async () => {
    const verify = vi.fn().mockResolvedValue({
      privyUserId: " did:privy:fan-123 ",
      verifiedEmail: "Fan@Example.COM",
    });

    await expect(authenticatePrivyAccessToken("access-token", { verify })).resolves.toEqual({
      privyUserId: "did:privy:fan-123",
      verifiedEmail: "fan@example.com",
    });
  });

  it("maps token verification failure to an opaque 401", async () => {
    const verify = vi.fn().mockRejectedValue(new Error("raw provider detail"));

    const error = await authenticatePrivyAccessToken("bad-token", { verify }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ code: "AUTHENTICATION_REQUIRED", status: 401 });
    expect((error as Error).message).not.toContain("raw provider detail");
  });
});
