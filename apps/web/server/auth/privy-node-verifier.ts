import "server-only";

import { PrivyClient } from "@privy-io/node";

import { normalizeEvmAddress, type CanonicalWallet } from "../../features/auth/domain/identity";
import { AuthError } from "../../features/auth/domain/auth-errors";
import type { PrivyAccessVerifier } from "./authenticate-privy";
import { mapPrivyIdentity } from "../../features/auth/domain/identity";
import type { PrivySessionResolver } from "./session-sync";

interface PrivyTokenClaims {
  app_id: string;
  user_id: string;
}

interface PrivyLinkedAccountShape {
  type: string;
  email?: string | null;
  verified_at?: number;
  address?: string;
  chain_type?: string;
  connector_type?: string;
  wallet_client?: string;
}

interface PrivyUserShape {
  id: string;
  linked_accounts: PrivyLinkedAccountShape[];
}

export interface PrivyNodeClientPort {
  utils(): {
    auth(): {
      verifyAccessToken(accessToken: string): Promise<PrivyTokenClaims>;
    };
  };
  users(): {
    _get(userId: string): Promise<PrivyUserShape>;
  };
}

export interface PrivyNodeServerConfig {
  appId: string;
  appSecret: string;
  appEnvironment?: "development" | "production";
  testAccountLoginEnabled?: boolean;
}

interface WalletVisibilityOptions {
  walletVisibilityAttempts?: number;
  walletVisibilityDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

// Privy's access token can become valid before a newly provisioned embedded
// wallet is visible through the server API. Keep the first session sync open
// long enough for that documented asynchronous provisioning step to settle.
const DEFAULT_WALLET_VISIBILITY_ATTEMPTS = 20;
const DEFAULT_WALLET_VISIBILITY_DELAY_MS = 750;

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requireConfig(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function latestVerifiedGoogleEmail(user: PrivyUserShape): string | null {
  const account = user.linked_accounts
    .filter(
      (candidate) =>
        candidate.type === "google_oauth" &&
        typeof candidate.email === "string" &&
        typeof candidate.verified_at === "number" &&
        candidate.verified_at > 0,
    )
    .sort((left, right) => (right.verified_at ?? 0) - (left.verified_at ?? 0))[0];

  return account?.email ?? null;
}

function verifiedPrivyTestAccountEmail(user: PrivyUserShape): string | null {
  const account = user.linked_accounts
    .filter((candidate) => {
      const email = candidate.email ?? candidate.address;
      return (
        candidate.type === "email" &&
        typeof email === "string" &&
        email.toLowerCase().endsWith("@privy.io") &&
        typeof candidate.verified_at === "number" &&
        candidate.verified_at > 0
      );
    })
    .sort((left, right) => (right.verified_at ?? 0) - (left.verified_at ?? 0))[0];

  return account?.email ?? account?.address ?? null;
}

function verifiedFanEmail(user: PrivyUserShape, config: PrivyNodeServerConfig): string | null {
  const googleEmail = latestVerifiedGoogleEmail(user);
  if (googleEmail) return googleEmail;
  if (!config.testAccountLoginEnabled) return null;
  if (config.appEnvironment !== "development") {
    throw new Error("Privy Test Account login requires a development Privy app");
  }
  return verifiedPrivyTestAccountEmail(user);
}

export function createPrivyNodeAccessVerifier(
  config: PrivyNodeServerConfig,
  client?: PrivyNodeClientPort,
): PrivyAccessVerifier {
  const appId = requireConfig(config.appId, "Privy app ID");
  const appSecret = requireConfig(config.appSecret, "Privy app secret");
  const privy = client ?? new PrivyClient({ appId, appSecret });

  return {
    async verify(accessToken) {
      const claims = await privy.utils().auth().verifyAccessToken(accessToken);
      if (claims.app_id !== appId) {
        throw new Error("Privy application mismatch");
      }

      const user = await privy.users()._get(claims.user_id);
      if (user.id !== claims.user_id) {
        throw new Error("Privy token subject mismatch");
      }

      return {
        privyUserId: claims.user_id,
        verifiedEmail: verifiedFanEmail(user, config),
      };
    },
  };
}

export function extractEmbeddedEvmWallet(
  user: PrivyUserShape,
  chainId: number,
): CanonicalWallet | null {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("A valid target chain ID is required");
  }

  const wallet = user.linked_accounts.find(
    (account) =>
      account.type === "wallet" &&
      account.chain_type === "ethereum" &&
      account.connector_type === "embedded" &&
      account.wallet_client === "privy" &&
      typeof account.address === "string",
  );

  return wallet?.address
    ? { chainId, address: normalizeEvmAddress(wallet.address) }
    : null;
}

export function createPrivyNodeSessionResolver(
  config: PrivyNodeServerConfig,
  client?: PrivyNodeClientPort,
  options: WalletVisibilityOptions = {},
): PrivySessionResolver {
  const appId = requireConfig(config.appId, "Privy app ID");
  const appSecret = requireConfig(config.appSecret, "Privy app secret");
  const privy = client ?? new PrivyClient({ appId, appSecret });
  const attempts = options.walletVisibilityAttempts ?? DEFAULT_WALLET_VISIBILITY_ATTEMPTS;
  const delayMs = options.walletVisibilityDelayMs ?? DEFAULT_WALLET_VISIBILITY_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error("Wallet visibility attempts must be a positive integer");
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error("Wallet visibility delay must be non-negative");
  return {
    async resolve(accessToken, chainId) {
      const claims = await privy.utils().auth().verifyAccessToken(accessToken);
      if (claims.app_id !== appId) throw new Error("Privy application mismatch");
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const user = await privy.users()._get(claims.user_id);
        if (user.id !== claims.user_id) throw new Error("Privy token subject mismatch");
        const wallet = extractEmbeddedEvmWallet(user, chainId);
        if (wallet) {
          const identity = mapPrivyIdentity({
            privyUserId: user.id,
            verifiedEmail: verifiedFanEmail(user, config),
          });
          return { identity, wallet };
        }
        if (attempt < attempts) await sleep(delayMs);
      }
      throw new AuthError("INVALID_WALLET", 422, "An embedded EVM wallet is required");
    },
  };
}
