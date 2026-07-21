import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createPrivyNodeAccessVerifier,
  createPrivyNodeSessionResolver,
  extractEmbeddedEvmWallet,
} from "./privy-node-verifier";

describe("@privy-io/node server adapter", () => {
  it("verifies the access token and resolves the same Privy user's Google email", async () => {
    const verifyAccessToken = vi.fn().mockResolvedValue({
      app_id: "app-1",
      user_id: "did:privy:user-1",
    });
    const getUser = vi.fn().mockResolvedValue({
      id: "did:privy:user-1",
      linked_accounts: [
        { type: "google_oauth", email: "old@example.com", verified_at: 10 },
        { type: "google_oauth", email: "fan@example.com", verified_at: 20 },
      ],
    });
    const verifier = createPrivyNodeAccessVerifier(
      { appId: "app-1", appSecret: "secret" },
      {
        utils: () => ({ auth: () => ({ verifyAccessToken }) }),
        users: () => ({ _get: getUser }),
      },
    );

    await expect(verifier.verify("access-token")).resolves.toEqual({
      privyUserId: "did:privy:user-1",
      verifiedEmail: "fan@example.com",
    });
    expect(getUser).toHaveBeenCalledWith("did:privy:user-1");
  });

  it("rejects a provider response whose user does not match the token subject", async () => {
    const verifier = createPrivyNodeAccessVerifier(
      { appId: "app-1", appSecret: "secret" },
      {
        utils: () => ({
          auth: () => ({
            verifyAccessToken: vi.fn().mockResolvedValue({
              app_id: "app-1",
              user_id: "did:privy:user-1",
            }),
          }),
        }),
        users: () => ({
          _get: vi.fn().mockResolvedValue({
            id: "did:privy:user-2",
            linked_accounts: [],
          }),
        }),
      },
    );

    await expect(verifier.verify("access-token")).rejects.toThrow(/subject mismatch/i);
  });

  it("accepts only a verified @privy.io email account behind the development Test Account policy", async () => {
    const client = {
      utils: () => ({ auth: () => ({ verifyAccessToken: vi.fn().mockResolvedValue({ app_id: "app-1", user_id: "did:privy:test-1" }) }) }),
      users: () => ({ _get: vi.fn().mockResolvedValue({
        id: "did:privy:test-1",
        linked_accounts: [{ type: "email", address: "test-8129@privy.io", verified_at: 20 }],
      }) }),
    };

    await expect(createPrivyNodeAccessVerifier({
      appId: "app-1",
      appSecret: "secret",
      appEnvironment: "development",
      testAccountLoginEnabled: true,
    }, client).verify("access-token")).resolves.toEqual({
      privyUserId: "did:privy:test-1",
      verifiedEmail: "test-8129@privy.io",
    });
    await expect(createPrivyNodeAccessVerifier({
      appId: "app-1",
      appSecret: "secret",
      appEnvironment: "development",
      testAccountLoginEnabled: false,
    }, client).verify("access-token")).resolves.toEqual({
      privyUserId: "did:privy:test-1",
      verifiedEmail: null,
    });
  });

  it.each([
    [{ type: "email", address: "fan@example.com", verified_at: 20 }, "non-Privy domain"],
    [{ type: "email", address: "test-8129@privy.io" }, "unverified account"],
  ])("rejects a %s as a Test Account identity", async (linkedAccount, _reason) => {
    const verifier = createPrivyNodeAccessVerifier({
      appId: "app-1",
      appSecret: "secret",
      appEnvironment: "development",
      testAccountLoginEnabled: true,
    }, {
      utils: () => ({ auth: () => ({ verifyAccessToken: vi.fn().mockResolvedValue({ app_id: "app-1", user_id: "did:privy:test-1" }) }) }),
      users: () => ({ _get: vi.fn().mockResolvedValue({ id: "did:privy:test-1", linked_accounts: [linkedAccount] }) }),
    });
    await expect(verifier.verify("access-token")).resolves.toMatchObject({ verifiedEmail: null });
  });

  it("fails closed if Test Account policy is paired with a production Privy app", async () => {
    const verifier = createPrivyNodeAccessVerifier({
      appId: "app-1",
      appSecret: "secret",
      appEnvironment: "production",
      testAccountLoginEnabled: true,
    }, {
      utils: () => ({ auth: () => ({ verifyAccessToken: vi.fn().mockResolvedValue({ app_id: "app-1", user_id: "did:privy:test-1" }) }) }),
      users: () => ({ _get: vi.fn().mockResolvedValue({
        id: "did:privy:test-1",
        linked_accounts: [{ type: "email", address: "test-8129@privy.io", verified_at: 20 }],
      }) }),
    });
    await expect(verifier.verify("access-token")).rejects.toThrow(/development Privy app/i);
  });

  it("maps a Privy embedded EVM wallet to the configured GIWA chain", () => {
    expect(
      extractEmbeddedEvmWallet(
        {
          id: "did:privy:user-1",
          linked_accounts: [
            {
              type: "wallet",
              chain_type: "ethereum",
              connector_type: "embedded",
              wallet_client: "privy",
              address: "0xEEE82F960476C888950C798C444C1FD92CBBFE50",
            },
          ],
        },
        91342,
      ),
    ).toEqual({
      chainId: 91342,
      address: "0xeee82f960476c888950c798c444c1fd92cbbfe50",
    });
  });

  it("waits for Privy's newly provisioned embedded wallet to become visible", async () => {
    const verifyAccessToken = vi.fn().mockResolvedValue({
      app_id: "app-1",
      user_id: "did:privy:user-1",
    });
    const getUser = vi
      .fn()
      .mockResolvedValueOnce({
        id: "did:privy:user-1",
        linked_accounts: [
          { type: "google_oauth", email: "fan@example.com", verified_at: 20 },
        ],
      })
      .mockResolvedValueOnce({
        id: "did:privy:user-1",
        linked_accounts: [
          { type: "google_oauth", email: "fan@example.com", verified_at: 20 },
          {
            type: "wallet",
            chain_type: "ethereum",
            connector_type: "embedded",
            wallet_client: "privy",
            address: "0xEEE82F960476C888950C798C444C1FD92CBBFE50",
          },
        ],
      });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const resolver = createPrivyNodeSessionResolver(
      { appId: "app-1", appSecret: "secret" },
      {
        utils: () => ({ auth: () => ({ verifyAccessToken }) }),
        users: () => ({ _get: getUser }),
      },
      { walletVisibilityAttempts: 2, walletVisibilityDelayMs: 750, sleep },
    );

    await expect(resolver.resolve("access-token", 91342)).resolves.toEqual({
      identity: {
        privyUserId: "did:privy:user-1",
        verifiedEmail: "fan@example.com",
      },
      wallet: {
        chainId: 91342,
        address: "0xeee82f960476c888950c798c444c1fd92cbbfe50",
      },
    });
    expect(getUser).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(750);
  });
});
