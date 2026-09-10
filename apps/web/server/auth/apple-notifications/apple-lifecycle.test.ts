import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc }) }));

import { createPrivyNodeAccessVerifier, createPrivyNodeSessionResolver, createPrivyNodeReauthenticationResolver } from "../privy-node-verifier";
import { AppleLifecycleRepository, providerSubjectHash, privySessionHash, sha256 } from "./apple-lifecycle";

const config = { appId: "app-one", appSecret: "server-secret", appleLoginEnabled: true };
const mixedAccounts: Array<{
  type: string; subject?: string; email?: string; verified_at?: number;
  address?: string; chain_type?: string; connector_type?: string; wallet_client?: string;
}> = [
  { type: "apple_oauth", subject: "apple-owner", email: "owner@privaterelay.appleid.com", verified_at: 20 },
  { type: "google_oauth", subject: "google-owner", email: "owner@example.com", verified_at: 30 },
  { type: "wallet", address: "0x1111111111111111111111111111111111111111", chain_type: "ethereum", connector_type: "embedded", wallet_client: "privy" },
];
const denied = { allowed: false, generation: 1, appleState: "revoked", googleRecoveryAllowed: true, appleRecoveryAllowed: true };

function client(accounts = mixedAccounts, sessionId = "original-session") {
  return {
    utils: () => ({ auth: () => ({ verifyAccessToken: vi.fn().mockResolvedValue({
      app_id: "app-one", user_id: "did:privy:owner", session_id: sessionId,
    }) }) }),
    users: () => ({ _get: vi.fn().mockResolvedValue({ id: "did:privy:owner", linked_accounts: accounts }) }),
  };
}

beforeEach(() => {
  vi.stubEnv("APPLE_LIFECYCLE_ENABLED", "true");
  vi.stubEnv("SUPABASE_URL", "https://database.example.com");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role");
  rpc.mockReset().mockResolvedValue({ data: denied, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("Apple lifecycle across Privy authentication paths", () => {
  it("denies a mixed account through both API verification and session sync despite a Google link", async () => {
    await expect(createPrivyNodeAccessVerifier(config, client()).verify("token"))
      .rejects.toMatchObject({ code: "APPLE_REAUTHENTICATION_REQUIRED", providers: ["google", "apple"] });
    await expect(createPrivyNodeSessionResolver(config, client()).resolve("token", 91342))
      .rejects.toMatchObject({ code: "APPLE_REAUTHENTICATION_REQUIRED" });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("check_apple_session_access", { p_identity: {
      privyUserId: "did:privy:owner", sessionHash: privySessionHash("did:privy:owner", "original-session"),
      appleSubjectHash: providerSubjectHash("apple", "apple-owner"),
      appleEmailFingerprint: sha256("owner@privaterelay.appleid.com"),
      googleSubjectHash: providerSubjectHash("google", "google-owner"),
    } });
  });

  it("still queries persisted state after Privy no longer returns the Apple link", async () => {
    await expect(createPrivyNodeAccessVerifier(config, client(mixedAccounts.slice(1))).verify("refreshed-token"))
      .rejects.toMatchObject({ code: "APPLE_REAUTHENTICATION_REQUIRED" });
    expect(rpc.mock.calls[0][1].p_identity).toMatchObject({ appleSubjectHash: null, appleEmailFingerprint: null });
  });

  it("preserves Google email precedence for an allowed specific session", async () => {
    rpc.mockResolvedValue({ data: { ...denied, allowed: true }, error: null });
    await expect(createPrivyNodeAccessVerifier(config, client()).verify("token")).resolves.toEqual({
      privyUserId: "did:privy:owner", verifiedEmail: "owner@example.com", googleLinked: true,
    });
  });

  it("does not register a normal shared Apple email as a relay destination", async () => {
    const accounts = mixedAccounts.map((account) => account.type === "apple_oauth" ? { ...account, email: "shared@example.com" } : account);
    await expect(createPrivyNodeAccessVerifier(config, client(accounts)).verify("token")).rejects.toBeDefined();
    expect(rpc.mock.calls[0][1].p_identity.appleEmailFingerprint).toBeNull();
  });

  it("fails closed without a verified session ID or when the state store fails", async () => {
    await expect(createPrivyNodeAccessVerifier(config, client(mixedAccounts, "")).verify("token")).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { message: "private database detail" } });
    await expect(createPrivyNodeSessionResolver(config, client()).resolve("token", 91342)).rejects.toThrow("temporarily unavailable");
  });

  it("allows only the raw recovery resolver to obtain proof inputs without granting application access", async () => {
    const resolver = createPrivyNodeReauthenticationResolver(config, client());
    await expect(resolver.resolve("token")).resolves.toMatchObject({
      privyUserId: "did:privy:owner", sessionId: "original-session", apple: { subject: "apple-owner" },
    });
    expect(rpc).not.toHaveBeenCalled();
    await expect(resolver.findProviderSubject("did:privy:owner", "google")).resolves.toBe("google-owner");
  });

  it("retains the existing Google path while lifecycle activation is off", async () => {
    vi.stubEnv("APPLE_LIFECYCLE_ENABLED", "false");
    await expect(createPrivyNodeAccessVerifier(config, client()).verify("token")).resolves.toHaveProperty("googleLinked", true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed state-store responses rather than treating them as allowed", async () => {
    rpc.mockResolvedValue({ data: { allowed: "true" }, error: null });
    await expect(new AppleLifecycleRepository({ rpc }).check({
      privyUserId: "did:privy:owner", sessionId: "session", google: null, apple: null,
    })).rejects.toThrow();
  });
});
