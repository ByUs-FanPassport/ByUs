import { getAddress } from "viem";
import { actionCodes, linkOrigins } from "./action-domain.js";

export interface IndexedCredential {
  credentialKey: string;
  kind: number;
  linkOrigin: number;
  nftContract: string;
  tokenId: string;
}

export interface IndexedFanAction {
  chainId: number;
  occurrenceId: string;
  actionId: string;
  revision: number;
  actionCode: number;
  recipient: string;
  environmentId: string;
  hubProxy: string;
  schemaUid: string;
  easAttester: string;
  easRecipient: string;
  easRevocationTime: bigint;
  easExpirationTime: bigint;
  easIsAttestationValid: boolean;
  status: "ACTIVE" | "INVALIDATED";
  origin: "NATIVE" | "HISTORICAL";
  finality: "included" | "safe" | "finalized";
  txHash: string;
  credentials: readonly IndexedCredential[];
}

export interface MetricTrustBoundary {
  chainId: number;
  environmentId: string;
  hubProxy: string;
  schemaUid: string;
  asOfEpochSeconds: bigint;
}

export interface FanActionMetrics {
  uniqueActiveWallets: number;
  actionCounts: Record<number, number>;
  passportCredentials: number;
  mintedCredentials: number;
  collectibleClaims: number;
  transactions: number;
  historicalActions: number;
  excluded: number;
}

export function isTrustedCurrentAction(action: IndexedFanAction, boundary: MetricTrustBoundary): boolean {
  const issuerMatches = getAddress(action.hubProxy) === getAddress(boundary.hubProxy)
    && getAddress(action.easAttester) === getAddress(boundary.hubProxy);
  const recipientMatches = getAddress(action.easRecipient) === getAddress(action.recipient);
  const expirationValid = action.easExpirationTime === 0n || action.easExpirationTime > boundary.asOfEpochSeconds;
  return action.chainId === boundary.chainId
    && action.environmentId.toLowerCase() === boundary.environmentId.toLowerCase()
    && action.schemaUid.toLowerCase() === boundary.schemaUid.toLowerCase()
    && issuerMatches
    && recipientMatches
    && action.status === "ACTIVE"
    && action.finality === "finalized"
    && action.easIsAttestationValid
    && action.easRevocationTime === 0n
    && expirationValid;
}

function belongsToTrustDomain(action: IndexedFanAction, boundary: MetricTrustBoundary): boolean {
  return action.chainId === boundary.chainId
    && action.environmentId.toLowerCase() === boundary.environmentId.toLowerCase()
    && action.schemaUid.toLowerCase() === boundary.schemaUid.toLowerCase()
    && getAddress(action.hubProxy) === getAddress(boundary.hubProxy)
    && getAddress(action.easAttester) === getAddress(boundary.hubProxy);
}

export function aggregateFanActionMetrics(actions: readonly IndexedFanAction[], boundary: MetricTrustBoundary, options: { includeHistorical?: boolean } = {}): FanActionMetrics {
  const latest = new Map<string, IndexedFanAction>();
  for (const action of actions.filter((candidate) => belongsToTrustDomain(candidate, boundary))) {
    const current = latest.get(action.occurrenceId.toLowerCase());
    if (!current || action.revision > current.revision) latest.set(action.occurrenceId.toLowerCase(), action);
  }
  const current = [...latest.values()].filter((action) => isTrustedCurrentAction(action, boundary));
  const trusted = current.filter((action) => options.includeHistorical || action.origin !== "HISTORICAL");
  const actionCounts: Record<number, number> = {};
  const wallets = new Set<string>();
  const txs = new Set<string>();
  const passports = new Set<string>();
  const minted = new Set<string>();
  let collectibleClaims = 0;
  for (const action of trusted) {
    wallets.add(getAddress(action.recipient));
    txs.add(action.txHash.toLowerCase());
    actionCounts[action.actionCode] = (actionCounts[action.actionCode] ?? 0) + 1;
    let linkedCollectible = false;
    for (const credential of action.credentials) {
      if (credential.kind === 0) passports.add(credential.credentialKey.toLowerCase());
      if (credential.linkOrigin === linkOrigins.MINTED_NOW) minted.add(credential.credentialKey.toLowerCase());
      if (credential.kind === 2) linkedCollectible = true;
    }
    if (action.actionCode === actionCodes.COLLECTIBLE_CLAIMED && linkedCollectible) collectibleClaims += 1;
  }
  return {
    uniqueActiveWallets: wallets.size,
    actionCounts,
    passportCredentials: passports.size,
    mintedCredentials: minted.size,
    collectibleClaims,
    transactions: txs.size,
    historicalActions: current.filter((action) => action.origin === "HISTORICAL").length,
    excluded: latest.size - trusted.length,
  };
}
