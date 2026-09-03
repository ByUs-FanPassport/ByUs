import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { SupabaseConnectedAccountRepository } from "./connected-account-repository";

it("reads only the canonical owner's connected-account projection", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: { accounts: [{ provider: "google", status: "connected", connectedAt: "2026-09-04T00:00:00.000Z", disconnectedAt: null }], channels: [] }, error: null });
  const repository = new SupabaseConnectedAccountRepository({ rpc });
  await expect(repository.listOwned("owner")).resolves.toHaveLength(1);
  expect(rpc).toHaveBeenCalledWith("get_owned_notification_connections", { p_app_user_id: "owner" });
});
