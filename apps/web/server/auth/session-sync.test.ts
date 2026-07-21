import { describe, expect, it, vi } from "vitest";
import { syncAuthenticatedSession } from "./session-sync";

describe("syncAuthenticatedSession", () => {
  it("persists only a resolver-verified identity and embedded wallet", async () => {
    const resolved = {
      identity: { privyUserId: "did:privy:user-1", verifiedEmail: "biz@sallylab.io" },
      wallet: { chainId: 91342, address: "0x82162619589cfe3e0dcc58c43dfbf121844f8e9c" },
    };
    const resolver = { resolve: vi.fn().mockResolvedValue(resolved) };
    const repository = { sync: vi.fn().mockResolvedValue(undefined) };
    await syncAuthenticatedSession({ authorization: "Bearer token", chainId: 91342, resolver, repository });
    expect(resolver.resolve).toHaveBeenCalledWith("token", 91342);
    expect(repository.sync).toHaveBeenCalledWith(resolved.identity, resolved.wallet);
  });

  it("rejects a request without a bearer token before touching storage", async () => {
    const resolver = { resolve: vi.fn() };
    const repository = { sync: vi.fn() };
    await expect(syncAuthenticatedSession({ authorization: "", chainId: 91342, resolver, repository }))
      .rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED", status: 401 });
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(repository.sync).not.toHaveBeenCalled();
  });
});
