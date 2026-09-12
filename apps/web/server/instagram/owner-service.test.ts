import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createInstagramOwnerService } from "./owner-service";
import { newSecret, secretHash, tokenVault } from "./crypto";
import { tokenBinding } from "./service";
import type { InstagramOwnerRepository } from "./owner-repository";
import type { InstagramProvider } from "./model";

const celebrityId = "11111111-1111-4111-8111-111111111111";
const generation = "22222222-2222-4222-8222-222222222222";
const actor = "33333333-3333-4333-8333-333333333333";
const identity = { id: "1234", user_id: "5678", username: "creator", account_type: "BUSINESS" as const };
const vault = tokenVault(Buffer.alloc(32, 71).toString("base64"));
function setup() {
  const diagnostics: unknown[] = [];
  const repository = {
    transition: vi.fn<InstagramOwnerRepository["transition"]>().mockResolvedValue({ celebrity_id: celebrityId, generation, locale: "ko" }),
    disconnect: vi.fn<InstagramOwnerRepository["disconnect"]>().mockResolvedValue({ celebrity_id: celebrityId, identity, token_ciphertext: vault.seal("provider-fixture-token", tokenBinding(celebrityId, identity)) }),
  };
  const provider = { exchange: vi.fn().mockResolvedValue({ identity, token: { accessToken: "provider-fixture-token", expiresIn: 3600 } }), revoke: vi.fn().mockResolvedValue(undefined) };
  const service = createInstagramOwnerService({
    repository: repository as unknown as InstagramOwnerRepository,
    provider: provider as unknown as InstagramProvider,
    vault,
    now: () => Date.parse("2026-09-13T00:00:00Z"),
    diagnostic: (event) => diagnostics.push(event),
  });
  return { service, repository, provider, diagnostics };
}
describe("owner Instagram service boundary", () => {
  it("consumes browser state before exchange, binds ciphertext to resolved creator, returns only pending nonce", async () => {
    const { service, repository, provider } = setup();
    const state = newSecret(), browser = newSecret();
    const pending = await service.callback("provider-code", state, browser);
    expect(repository.transition.mock.calls.map(call => call[0])).toEqual(["consume", "resolve", "pending"]);
    expect(repository.transition.mock.calls[0]).toEqual(["consume", secretHash(state), null, secretHash(browser)]);
    expect(repository.transition.mock.invocationCallOrder[0]).toBeLessThan(provider.exchange.mock.invocationCallOrder[0]);
    const payload = repository.transition.mock.calls[2][4]!;
    expect(payload.next_hash).toBe(secretHash(pending));
    expect(payload.token_expires_at).toBe("2026-09-13T01:00:00.000Z");
    expect(JSON.stringify(payload)).not.toContain("provider-fixture-token");
    expect(vault.open(String(payload.token_ciphertext), tokenBinding(celebrityId, identity))).toBe("provider-fixture-token");
    expect(() => vault.open(String(payload.token_ciphertext), tokenBinding(actor, identity))).toThrow();
  });
  it("never exchanges provider code after a replay or browser-binding failure", async () => {
    const { service, repository, provider } = setup();
    repository.transition.mockRejectedValueOnce(new Error("OWNER_FLOW"));
    await expect(service.callback("provider-code", newSecret(), newSecret())).rejects.toThrow("OWNER_FLOW");
    expect(provider.exchange).not.toHaveBeenCalled();
  });
  it("cancels unmatched identity without persisting token or damaging an existing connection", async () => {
    const { service, repository, diagnostics } = setup();
    repository.transition.mockResolvedValueOnce({ locale: "ko" }).mockRejectedValueOnce(new Error("OWNER_ACCOUNT_MISMATCH"));
    await expect(service.callback("provider-code", newSecret(), newSecret())).rejects.toThrow("OWNER_ACCOUNT_MISMATCH");
    expect(repository.transition.mock.calls.map(call => call[0])).toEqual(["consume", "resolve", "cancel"]);
    expect(repository.disconnect).not.toHaveBeenCalled();
    expect(diagnostics).toEqual([{ stage: "resolve", reason: "account_mismatch" }]);
  });
  it("reports sanitized pending storage failures without logging callback secrets", async () => {
    const { service, repository, diagnostics } = setup();
    repository.transition
      .mockResolvedValueOnce({ locale: "ko" })
      .mockResolvedValueOnce({ celebrity_id: celebrityId, generation, locale: "ko" })
      .mockRejectedValueOnce(new Error("private database payload provider-code creator"));

    await expect(service.callback("private-provider-code", newSecret(), newSecret())).rejects.toThrow("private database payload");

    expect(diagnostics).toEqual([{ stage: "pending", reason: "unknown" }]);
    expect(JSON.stringify(diagnostics)).not.toMatch(/private|provider-code|creator|database|payload/);
  });
  it("erases owner connection first and reports unconfirmed remote revocation honestly", async () => {
    const { service, repository, provider } = setup();
    provider.revoke.mockRejectedValueOnce(new Error("provider unavailable"));
    expect(await service.disconnect(actor, celebrityId, generation)).toEqual({ disconnected: true, remoteRevocation: "unconfirmed" });
    expect(repository.disconnect).toHaveBeenCalledWith(actor, celebrityId, generation);
    expect(repository.disconnect.mock.invocationCallOrder[0]).toBeLessThan(provider.revoke.mock.invocationCallOrder[0]);
  });
  it("cannot revoke a token if ownership or generation check rejects local disconnect", async () => {
    const { service, repository, provider } = setup();
    repository.disconnect.mockRejectedValueOnce(new Error("OWNER_STALE"));
    await expect(service.disconnect(actor, celebrityId, generation)).rejects.toThrow("OWNER_STALE");
    expect(provider.revoke).not.toHaveBeenCalled();
  });
});
