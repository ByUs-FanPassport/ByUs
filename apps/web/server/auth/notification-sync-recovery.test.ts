import { describe, expect, it, vi } from "vitest";
import { canDeferNotificationSync } from "./notification-sync-recovery";
vi.mock("server-only", () => ({}));
const identity = { privyUserId: "did:privy:owner", verifiedEmail: "fan@example.com", googleLinked: true };
describe("notification projection recovery", () => {
  it("uses the boolean-only service-role proof with canonical owner identity", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    expect(await canDeferNotificationSync({ rpc }, "owner", identity)).toBe(true);
    expect(rpc).toHaveBeenCalledWith("can_defer_owned_notification_sync", {
      p_app_user_id: "owner", p_privy_user_id: identity.privyUserId,
      p_verified_email: identity.verifiedEmail, p_google_connected: true,
    });
  });
  it.each([false, null, {}, "true"])("fails closed unless proof is exactly true: %s", async (data) => {
    expect(await canDeferNotificationSync({ rpc: vi.fn().mockResolvedValue({ data, error: null }) }, "owner", identity)).toBe(false);
  });
  it("fails closed on a database permission or availability error", async () => {
    expect(await canDeferNotificationSync({ rpc: vi.fn().mockResolvedValue({ data: true, error: { message: "permission denied" } }) }, "owner", identity)).toBe(false);
  });
});
