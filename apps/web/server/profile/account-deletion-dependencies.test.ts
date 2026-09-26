import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  verify: vi.fn(), authorize: vi.fn(), rpc: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@privy-io/node", () => ({ PrivyClient: class { utils() { return { auth: () => ({ verifyAccessToken: state.verify }) }; } users() { return { delete: vi.fn() }; } } }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: state.rpc, storage: { from: vi.fn() } }) }));
vi.mock("@/server/config/env", () => ({ loadServerEnv: () => ({ SUPABASE_URL: "https://test.invalid", SUPABASE_SERVICE_ROLE_KEY: "test", PRIVY_APP_ID: "app", PRIVY_APP_SECRET: "test", PRIVY_APPLE_LOGIN_ENABLED: true }) }));
vi.mock("@/server/auth/privy-node-verifier", () => ({ createPrivyNodeAccessVerifier: () => ({ verify: vi.fn() }) }));
vi.mock("@/server/fan-auth/supabase-fan-auth-repository", () => ({ createSupabaseFanAuthRepository: () => ({}) }));
vi.mock("@/server/fan-auth/fan-auth-gate", () => ({ authorizeFanRequest: state.authorize }));
import { AuthError } from "@/features/auth/domain/auth-errors";
import { createAccountDeletionDependencies } from "./account-deletion-dependencies";
import { createDeleteAccountHandler } from "./account-deletion";
beforeEach(() => {
  vi.clearAllMocks(); state.verify.mockResolvedValue({ app_id: "app", user_id: "did:privy:owner" });
  state.rpc.mockResolvedValue({ data: false, error: null }); state.authorize.mockResolvedValue({ appUserId: "owner" });
});
it("first deletion obeys the full fan/Apple lifecycle gate and creates no request on denial", async () => {
  state.authorize.mockRejectedValue(new AuthError("APPLE_REAUTHENTICATION_REQUIRED", 403, "Reauthenticate"));
  const response = await createDeleteAccountHandler(createAccountDeletionDependencies())(new Request("https://test.invalid/api/me/account", { method: "DELETE", headers: { authorization: "Bearer stale", "content-type": "application/json" }, body: '{"confirmation":"DELETE"}' }));
  expect(response.status).toBe(403);
  expect(state.authorize).toHaveBeenCalledWith(expect.objectContaining({ authorization: "Bearer stale" }));
  expect(state.rpc).toHaveBeenCalledTimes(1);
  expect(state.rpc).toHaveBeenCalledWith("has_approved_account_deletion", { p_privy_user_id: "did:privy:owner" });
});
it("permits a verified subject to retry only an already approved deletion", async () => {
  state.rpc.mockResolvedValue({ data: true, error: null });
  expect(await createAccountDeletionDependencies().verifySubject("Bearer old-session")).toBe("did:privy:owner");
  expect(state.authorize).not.toHaveBeenCalled();
  state.verify.mockResolvedValue({ app_id: "wrong-app", user_id: "did:privy:owner" });
  await expect(createAccountDeletionDependencies().verifySubject("Bearer bad")).rejects.toMatchObject({ status: 401 });
});
