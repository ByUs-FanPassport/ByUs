import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { resolveSharedPassport, readSharedPassportActivity } from "./shared-passport";

describe("anonymous shared Passport projection", () => {
  it("reads only verified public activity fields and denies revoked links", async () => {
    const card = { creator: "elina", issuedAt: "2026-09-26T00:00:00+00:00", tier: "Bronze", score: 50, activityCount: 1, stampCount: 2 };
    const rpc = vi.fn().mockResolvedValue(card);
    expect(await readSharedPassportActivity("a".repeat(32), { rpc })).toEqual(card);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("read_shared_passport_activity", { p_token: "a".repeat(32) });
    rpc.mockResolvedValue({ ...card, appUserId: "private" });
    await expect(readSharedPassportActivity("a".repeat(32), { rpc })).rejects.toThrow("Shared Passport is unavailable");
    rpc.mockResolvedValue(null);
    expect(await readSharedPassportActivity("a".repeat(32), { rpc })).toBeNull();
  });
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
