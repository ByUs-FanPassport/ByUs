import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { resolveSharedPassport } from "./shared-passport";

describe("anonymous shared Passport projection", () => {
  it("rejects malformed tokens without accessing storage", async () => {
    const rpc = vi.fn();
    expect(await resolveSharedPassport("../someone", { rpc })).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("only resolves a public creator and never records a visit", async () => {
    const rpc = vi.fn().mockResolvedValue({ creator: "elina" });
    const token = "a".repeat(32);
    expect(await resolveSharedPassport(token, { rpc })).toEqual({ creator: "elina" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("resolve_community_stamp_share_link", { p_token: token });
  });
  it("rejects accidental private fields and sanitizes failures", async () => {
    const rpc = vi.fn().mockResolvedValue({ creator: "elina", senderWallet: "secret" });
    await expect(resolveSharedPassport("a".repeat(32), { rpc })).rejects.toThrow("Shared Passport is unavailable");
    rpc.mockRejectedValue(new Error("COMMUNITY_STAMP_NOT_FOUND"));
    expect(await resolveSharedPassport("a".repeat(32), { rpc })).toBeNull();
  });
});
