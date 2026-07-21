import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { SupabaseSessionSyncRepository } from "./supabase-session-sync-repository";

const identity = { privyUserId: "did:privy:user-1", verifiedEmail: "fan@example.com" };
const wallet = { chainId: 91342, address: "0x82162619589cfe3e0dcc58c43dfbf121844f8e9c" };

describe("SupabaseSessionSyncRepository profile state", () => {
  it("returns profile completion after atomic identity synchronization", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ app_user_id: "user-1", wallet_id: "wallet-1" }], error: null })
      .mockResolvedValueOnce({ data: { completed: true, nickname: "Fan12" }, error: null });
    const repository = new SupabaseSessionSyncRepository({ rpc });
    await expect(repository.sync(identity, wallet)).resolves.toEqual({ completed: true, nickname: "Fan12" });
    expect(rpc).toHaveBeenNthCalledWith(2, "get_owned_user_profile", { p_app_user_id: "user-1" });
  });

  it("fails closed when owner identity or profile state is malformed", async () => {
    const malformedOwner = new SupabaseSessionSyncRepository({ rpc: vi.fn().mockResolvedValue({ data: [], error: null }) });
    await expect(malformedOwner.sync(identity, wallet)).rejects.toThrow("invalid owner");

    const malformedProfile = new SupabaseSessionSyncRepository({ rpc: vi.fn()
      .mockResolvedValueOnce({ data: [{ app_user_id: "user-1" }], error: null })
      .mockResolvedValueOnce({ data: { completed: true, nickname: null }, error: null }) });
    await expect(malformedProfile.sync(identity, wallet)).rejects.toThrow("invalid data");
  });
});
