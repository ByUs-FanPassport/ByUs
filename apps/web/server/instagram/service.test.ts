import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createInstagramService, tokenBinding } from "./service";
import { tokenVault } from "./crypto";
import { InstagramError, type InstagramConnection, type InstagramProvider } from "./model";
import type { InstagramRepository } from "./repository";

const now = Date.parse("2026-09-08T00:00:00Z");
const identity = { id: "102000000000001", user_id: "178400000000001", username: "creator_test", account_type: "BUSINESS" as const };
const celebrityId = "11111111-1111-4111-8111-111111111111";
const vault = tokenVault(Buffer.alloc(32, 9).toString("base64"));
function setup(overrides: Partial<InstagramConnection> = {}) {
  const connection: InstagramConnection = { celebrity_id: celebrityId, generation: "22222222-2222-4222-8222-222222222222", lease_id: "33333333-3333-4333-8333-333333333333", identity, token_ciphertext: vault.seal("old-test-token", tokenBinding(celebrityId, identity)), token_issued_at: new Date(now - 86400000 * 55).toISOString(), token_expires_at: new Date(now + 86400000 * 5).toISOString(), ...overrides };
  const repository = {
    transition: vi.fn<InstagramRepository["transition"]>(async () => ({ celebrity_id: celebrityId, generation: connection.generation, expected_username: "creator_test", expected_user_id: identity.user_id, payload: {}, expires_at: new Date(now + 600000).toISOString() })),
    disconnect: vi.fn(async () => ({ celebrity_id: celebrityId, identity, token_ciphertext: connection.token_ciphertext })),
    claimSync: vi.fn(async () => [connection]), finishSync: vi.fn<InstagramRepository["finishSync"]>(async () => true),
  };
  const provider = { exchange: vi.fn(async () => ({ identity, token: { accessToken: "new-test-token", expiresIn: 5184000 } })), refresh: vi.fn(async () => ({ accessToken: "refreshed-test-token", expiresIn: 5184000 })), media: vi.fn(async () => []), revoke: vi.fn(async () => undefined) };
  const service = createInstagramService({ repository: repository as unknown as InstagramRepository, provider: provider as unknown as InstagramProvider, vault, now: () => now });
  return { service, repository, provider, connection };
}

describe("Instagram lifecycle service", () => {
  it("checks expected account before storing encrypted pending token", async () => {
    const { service, repository } = setup();
    await service.callback("code", "state", "browser");
    const payload = repository.transition.mock.calls[1][3] as Record<string, string>;
    expect(payload.token_ciphertext).not.toContain("new-test-token");
    expect(vault.open(payload.token_ciphertext, tokenBinding(celebrityId, identity))).toBe("new-test-token");
  });
  it("rejects account mismatch and discards the exchange state", async () => {
    const { service, repository, provider } = setup();
    provider.exchange.mockResolvedValueOnce({ identity: { ...identity, username: "someone_else" }, token: { accessToken: "test", expiresIn: 60 } });
    await expect(service.callback("code", "state", "browser")).rejects.toMatchObject({ code: "ACCOUNT_MISMATCH" });
    expect(repository.transition.mock.calls.map((call) => call[0])).toEqual(["consume", "cancel"]);
  });
  it("commits local disconnect even when remote revocation times out", async () => {
    const { service, repository, provider } = setup();
    provider.revoke.mockRejectedValueOnce(new Error("timeout"));
    expect(await service.disconnect(celebrityId)).toEqual({ disconnected: true, remoteRevocation: "unconfirmed" });
    expect(repository.disconnect.mock.invocationCallOrder[0]).toBeLessThan(provider.revoke.mock.invocationCallOrder[0]);
  });
  it("refreshes only mature, unexpired tokens and encrypts replacements", async () => {
    const { service, provider, repository } = setup();
    expect(await service.sync()).toEqual([{ celebrityId, status: "updated" }]);
    expect(provider.media).toHaveBeenCalledWith("refreshed-test-token", identity);
    const result = repository.finishSync.mock.calls[0][1] as Record<string, string>;
    expect(vault.open(result.token_ciphertext, tokenBinding(celebrityId, identity))).toBe("refreshed-test-token");
    const fresh = setup({ token_issued_at: new Date(now - 1000).toISOString() });
    await fresh.service.sync();
    expect(fresh.provider.refresh).not.toHaveBeenCalled();
  });
  it("expires revoked/expired credentials locally and never attempts to refresh expired tokens", async () => {
    const expired = setup({ token_expires_at: new Date(now - 1).toISOString() });
    expect(await expired.service.sync()).toEqual([{ celebrityId, status: "reauth_required" }]);
    expect(expired.provider.refresh).not.toHaveBeenCalled();
    expect(expired.repository.disconnect).toHaveBeenCalledWith(celebrityId, expired.connection.generation);
    const revoked = setup();
    revoked.provider.media.mockRejectedValueOnce(new InstagramError("REAUTH_REQUIRED"));
    await revoked.service.sync();
    expect(revoked.repository.disconnect).toHaveBeenCalled();
  });
  it("hides failed media, retains successful token refresh, and respects a superseded generation", async () => {
    const { service, repository, provider } = setup();
    provider.media.mockRejectedValueOnce(new InstagramError("UNAVAILABLE"));
    repository.finishSync.mockResolvedValueOnce(false);
    expect(await service.sync()).toEqual([{ celebrityId, status: "superseded" }]);
    expect(repository.finishSync).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ error: "MEDIA_UNAVAILABLE", token_ciphertext: expect.any(String) }));
  });
});
