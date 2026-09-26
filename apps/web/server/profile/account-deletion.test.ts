import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthError } from "@/features/auth/domain/auth-errors";
import { createDeleteAccountHandler, processAccountDeletion, processContentAssetCleanup, type AccountDeletionDependencies } from "./account-deletion";
const owner = "22222222-2222-4222-8222-222222222222";
const lease = "33333333-3333-4333-8333-333333333333";
const object = { id: "44444444-4444-4444-8444-444444444444", bucket: "fan-avatars", path: `${owner}/photo.webp`, generation: 4 };
function dependencies() {
  const rpc = vi.fn(async (name: string): Promise<unknown> => ({
    begin_owned_account_deletion: { appUserId: owner, status: "pending" },
    claim_content_asset_cleanup: { items: [] },
    claim_account_deletion: { appUserId: owner, leaseToken: lease, providerSubject: "did:privy:owner", objects: [object] },
    account_deletion_storage_ready: true, complete_account_deletion: true,
  })[name as "begin_owned_account_deletion"] ?? null);
  return { verifySubject: vi.fn().mockResolvedValue("did:privy:owner"), rpc, removeObject: vi.fn().mockResolvedValue(undefined), deleteProviderUser: vi.fn().mockResolvedValue(undefined) } satisfies AccountDeletionDependencies;
}
const request = (body = '{"confirmation":"DELETE"}') => new Request("https://byus.test/api/me/account", { method: "DELETE", headers: { Authorization: "Bearer verified", "Content-Type": "application/json" }, body });
describe("durable account deletion", () => {
  it("requires confirmation and lifecycle authorization before creating a request", async () => {
    const deps = dependencies();
    expect((await createDeleteAccountHandler(deps)(request('{}'))).status).toBe(400);
    expect(deps.rpc).not.toHaveBeenCalled();
    deps.verifySubject.mockRejectedValue(new AuthError("APPLE_REAUTHENTICATION_REQUIRED", 403, "Reauthenticate"));
    const response = await createDeleteAccountHandler(deps)(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "APPLE_REAUTHENTICATION_REQUIRED" } });
    expect(deps.rpc).not.toHaveBeenCalled();
  });
  it("finishes storage generations before provider deletion and reports actual completion", async () => {
    const deps = dependencies(); const response = await createDeleteAccountHandler(deps)(request());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ deletion: { status: "completed" } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(deps.rpc).toHaveBeenCalledWith("begin_owned_account_deletion", { p_privy_user_id: "did:privy:owner" });
    expect(deps.rpc).toHaveBeenCalledWith("finish_account_deletion_object", { p_app_user_id: owner, p_lease_token: lease, p_object_id: object.id, p_generation: 4 });
    expect(deps.removeObject.mock.invocationCallOrder[0]).toBeLessThan(deps.deleteProviderUser.mock.invocationCallOrder[0]);
  });
  it("keeps failed storage/provider work pending with a retry and no false completion", async () => {
    const deps = dependencies(); deps.removeObject.mockRejectedValue(new Error("secret storage payload"));
    const response = await createDeleteAccountHandler(deps)(request());
    expect(response.status).toBe(202); expect(await response.json()).toEqual({ deletion: { status: "pending" } });
    expect(deps.deleteProviderUser).not.toHaveBeenCalled();
    expect(deps.rpc).toHaveBeenCalledWith("retry_account_deletion", expect.objectContaining({ p_error_code: "STORAGE_UNAVAILABLE" }));
    deps.removeObject.mockResolvedValue(undefined); deps.deleteProviderUser.mockRejectedValue(new Error("provider unavailable"));
    expect(await processAccountDeletion(deps, owner)).toBe("pending");
    expect(deps.rpc).toHaveBeenCalledWith("retry_account_deletion", expect.objectContaining({ p_error_code: "PROVIDER_UNAVAILABLE" }));
  });
  it("does not delete the provider while a late upload or another batch remains", async () => {
    const deps = dependencies(); const original = deps.rpc.getMockImplementation()!;
    deps.rpc.mockImplementation(async name => name === "account_deletion_storage_ready" ? false : original(name));
    expect(await processAccountDeletion(deps, owner)).toBe("pending");
    expect(deps.deleteProviderUser).not.toHaveBeenCalled();
  });
  it("passes A cleanup generation and sanitizes internal invalid responses as 503", async () => {
    const deps = dependencies(); deps.rpc.mockResolvedValueOnce({ items: [{ id: object.id, bucket: "fan-content-assets", storagePath: object.path, generation: 9 }] } as never);
    expect(await processContentAssetCleanup(deps)).toBe(1);
    expect(deps.rpc).toHaveBeenCalledWith("finish_content_asset_cleanup", { p_asset_id: object.id, p_generation: 9, p_succeeded: true });
    deps.rpc.mockResolvedValueOnce({ broken: "secret" } as never);
    expect((await createDeleteAccountHandler(deps)(request())).status).toBe(503);
  });
});
