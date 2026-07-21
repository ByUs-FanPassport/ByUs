import { AuthError } from "./auth-errors";

export interface PrivyIdentityInput {
  privyUserId: string;
  verifiedEmail: string | null;
}

export interface CanonicalPrivyIdentity {
  privyUserId: string;
  verifiedEmail: string;
}

export interface CanonicalWallet {
  chainId: number;
  address: string;
}

export interface WalletOwner {
  appUserId: string;
}

export type WalletLinkDecision =
  | { kind: "create"; wallet: CanonicalWallet }
  | { kind: "unchanged"; wallet: CanonicalWallet };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;

export function normalizeEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) {
    throw new AuthError("INVALID_EMAIL", 422, "A valid verified email is required");
  }
  return normalized;
}

export function mapPrivyIdentity(input: PrivyIdentityInput): CanonicalPrivyIdentity {
  const privyUserId = input.privyUserId.trim();
  if (!privyUserId) {
    throw new AuthError("INVALID_PRIVY_IDENTITY", 401, "Privy user ID is required");
  }
  if (!input.verifiedEmail) {
    throw new AuthError(
      "VERIFIED_EMAIL_REQUIRED",
      403,
      "A verified email is required for this account",
    );
  }
  return { privyUserId, verifiedEmail: normalizeEmail(input.verifiedEmail) };
}

export function normalizeEvmAddress(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!EVM_ADDRESS_PATTERN.test(normalized)) {
    throw new AuthError("INVALID_WALLET", 422, "A valid EVM wallet address is required");
  }
  return normalized;
}

function normalizeWallet(wallet: CanonicalWallet): CanonicalWallet {
  if (!Number.isSafeInteger(wallet.chainId) || wallet.chainId <= 0) {
    throw new AuthError("INVALID_WALLET", 422, "A valid chain ID is required");
  }
  return { chainId: wallet.chainId, address: normalizeEvmAddress(wallet.address) };
}

function sameWallet(left: CanonicalWallet, right: CanonicalWallet): boolean {
  return left.chainId === right.chainId && left.address === right.address;
}

export function decideWalletLink(input: {
  appUserId?: string;
  incoming: CanonicalWallet;
  existingForUser: CanonicalWallet | null;
  owner: WalletOwner | null;
}): WalletLinkDecision {
  const incoming = normalizeWallet(input.incoming);
  const existingForUser = input.existingForUser
    ? normalizeWallet(input.existingForUser)
    : null;

  if (input.owner && input.owner.appUserId !== input.appUserId) {
    throw new AuthError(
      "WALLET_ALREADY_LINKED",
      409,
      "This wallet is already linked to another account",
    );
  }

  if (existingForUser && !sameWallet(existingForUser, incoming)) {
    throw new AuthError(
      "WALLET_RELINK_REQUIRES_REVIEW",
      409,
      "Wallet relink requires an explicit reviewed operation",
    );
  }

  return existingForUser
    ? { kind: "unchanged", wallet: incoming }
    : { kind: "create", wallet: incoming };
}
