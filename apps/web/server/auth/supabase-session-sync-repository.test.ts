import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { SupabaseSessionSyncRepository } from "./supabase-session-sync-repository";

const identity = { privyUserId: "did:privy:user-1", verifiedEmail: "fan@example.com", googleLinked: true };
const wallet = { chainId: 91342, address: "0x82162619589cfe3e0dcc58c43dfbf121844f8e9c" };

describe("SupabaseSessionSyncRepository profile state", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns profile completion after atomic identity synchronization", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ app_user_id: "user-1", wallet_id: "wallet-1" }], error: null })
      .mockResolvedValueOnce({ data: "en", error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: { completed: true, nickname: "Fan12" }, error: null });
    const repository = new SupabaseSessionSyncRepository({ rpc });
    await expect(repository.sync(identity, wallet, "en")).resolves.toEqual({ completed: true, nickname: "Fan12" });
    expect(rpc).toHaveBeenNthCalledWith(2, "initialize_owned_preferred_locale", { p_app_user_id: "user-1", p_locale: "en" });
    expect(rpc).toHaveBeenNthCalledWith(3, "sync_owned_google_notification_channel", expect.objectContaining({ p_app_user_id: "user-1", p_google_connected: true }));
    expect(rpc).toHaveBeenNthCalledWith(4, "get_owned_user_profile", { p_app_user_id: "user-1" });
  });

  it("fails closed when owner identity or profile state is malformed", async () => {
    const malformedOwner = new SupabaseSessionSyncRepository({ rpc: vi.fn().mockResolvedValue({ data: [], error: null }) });
    await expect(malformedOwner.sync(identity, wallet, "ko")).rejects.toThrow("invalid owner");

    const malformedProfile = new SupabaseSessionSyncRepository({ rpc: vi.fn()
      .mockResolvedValueOnce({ data: [{ app_user_id: "user-1" }], error: null })
      .mockResolvedValueOnce({ data: "ko", error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: { completed: true, nickname: null }, error: null }) });
    await expect(malformedProfile.sync(identity, wallet, "ko")).rejects.toThrow("invalid data");
  });

  it("keeps a valid identity usable when locale initialization is not confirmed", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ app_user_id: "user-1" }], error: null })
      .mockResolvedValueOnce({ data: "fr", error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: { completed: true, nickname: "Fan12" }, error: null });
    const repository = new SupabaseSessionSyncRepository({ rpc });

    await expect(repository.sync(identity, wallet, "en")).resolves.toEqual({ completed: true, nickname: "Fan12" });
    expect(rpc).toHaveBeenCalledTimes(4);
  });

  it("keeps notification projection failure blocking by default", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ app_user_id: "user-1" }], error: null })
      .mockResolvedValueOnce({ data: "ko", error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "unavailable" } });
    const repository = new SupabaseSessionSyncRepository({ rpc });

    await expect(repository.sync(identity, wallet, "ko")).rejects.toThrow("Notification identity projection failed");
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it("continues only after an explicit bounded safe-fallback proof", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ app_user_id: "user-1" }], error: null })
      .mockResolvedValueOnce({ data: "ko", error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "unavailable" } })
      .mockResolvedValueOnce({ data: { completed: true, nickname: "Fan12" }, error: null });
    const canDeferNotificationSync = vi.fn().mockResolvedValue(true);
    const repository = new SupabaseSessionSyncRepository({ rpc }, { canDeferNotificationSync });

    await expect(repository.sync(identity, wallet, "ko")).resolves.toEqual({ completed: true, nickname: "Fan12" });
    expect(canDeferNotificationSync).toHaveBeenCalledWith("user-1", identity);
  });

  it("fails closed when the safe-fallback proof stalls", async () => {
    vi.useFakeTimers();
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ app_user_id: "user-1" }], error: null })
      .mockResolvedValueOnce({ data: "ko", error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "unavailable" } });
    const repository = new SupabaseSessionSyncRepository({ rpc }, {
      canDeferNotificationSync: () => new Promise(() => {}),
    });

    const result = repository.sync(identity, wallet, "ko");
    const rejected = expect(result).rejects.toThrow("Notification identity projection failed");
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it("does not consume the login deadline when both optional projections stall", async () => {
    vi.useFakeTimers();
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ app_user_id: "user-1" }], error: null })
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce({ data: { completed: true, nickname: "Fan12" }, error: null });
    const repository = new SupabaseSessionSyncRepository({ rpc }, { canDeferNotificationSync: async () => true });
    const result = repository.sync(identity, wallet, "ko");
    await vi.advanceTimersByTimeAsync(4_000);
    await expect(result).resolves.toEqual({ completed: true, nickname: "Fan12" });
    expect(rpc).toHaveBeenCalledTimes(4);
  });

  it("bounds an identity synchronization RPC that never settles", async () => {
    vi.useFakeTimers();
    const repository = new SupabaseSessionSyncRepository({
      rpc: vi.fn(() => new Promise<{ data: unknown; error: { message?: string } | null }>(() => {})),
    });
    const result = repository.sync(identity, wallet, "ko");
    const rejected = expect(result).rejects.toMatchObject({ name: "RequestTimeoutError" });
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
  });
});
