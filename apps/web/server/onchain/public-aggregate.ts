import { aggregateFanActionMetrics, isTrustedCurrentAction } from "../../../worker/src/action-metrics";
import type { FinalizedActionSnapshot } from "../../../worker/src/action-public-snapshot";
import { onchainConfig } from "./public-config";
import type { PublicOnchainSnapshot } from "./public-types";

/** Pure projection: every metric input comes from the validated chain snapshot. */
export function projectPublicOnchainSnapshot(source: FinalizedActionSnapshot, generatedAt = new Date()): PublicOnchainSnapshot {
  const boundary = { chainId: onchainConfig.chainId, environmentId: onchainConfig.environmentId, hubProxy: onchainConfig.hubAddress, schemaUid: onchainConfig.schemaUid, asOfEpochSeconds: source.timestamp };
  const qaWallets = new Set<string>(onchainConfig.qaWallets.map((wallet) => wallet.toLowerCase()));
  // A correction must never turn a QA occurrence or its original mint into fan activity.
  const qaOccurrences = new Set(source.actions.filter((action) => qaWallets.has(action.recipient.toLowerCase())).map((action) => action.occurrenceId.toLowerCase()));
  const qaActionIds = new Set(source.actions.filter((action) => qaOccurrences.has(action.occurrenceId.toLowerCase())).map((action) => action.actionId.toLowerCase()));
  const qaTx = (tx: FinalizedActionSnapshot["lifecycleTransactions"][number]) => tx.recipients.some((wallet) => qaWallets.has(wallet.toLowerCase())) || tx.actionIds.some((id) => qaActionIds.has(id.toLowerCase()));
  const businessActions = source.actions.filter((action) => !qaOccurrences.has(action.occurrenceId.toLowerCase()) && action.origin === "NATIVE");
  const business = aggregateFanActionMetrics(businessActions, boundary);
  const raw = aggregateFanActionMetrics(source.actions, boundary, { includeHistorical: true });
  const latest = new Map<string, number>();
  for (const action of source.actions) latest.set(action.occurrenceId.toLowerCase(), Math.max(latest.get(action.occurrenceId.toLowerCase()) ?? 0, action.revision));
  const metrics = (value: typeof business, lifecycleTransactions: number) => ({ uniqueActiveWallets: value.uniqueActiveWallets, actionCounts: value.actionCounts, passportCredentials: value.passportCredentials, mintedCredentials: value.mintedCredentials, currentActionTransactions: value.transactions, lifecycleTransactions });
  return {
    version: 1, network: onchainConfig.network, chainId: onchainConfig.chainId, hubAddress: onchainConfig.hubAddress,
    environmentId: onchainConfig.environmentId, schemaUid: onchainConfig.schemaUid,
    fromBlock: onchainConfig.fromBlock.toString(), blockNumber: source.blockNumber.toString(), blockHash: source.blockHash,
    blockTimestamp: new Date(Number(source.timestamp) * 1000).toISOString(), generatedAt: generatedAt.toISOString(),
    business: metrics(business, source.lifecycleTransactions.filter((tx) => !qaTx(tx) && tx.origin === "NATIVE").length),
    raw: metrics(raw, source.lifecycleTransactions.length),
    excludedQaWallets: [...onchainConfig.qaWallets], excludedQaActions: qaOccurrences.size, historicalActions: raw.historicalActions,
    actions: source.actions.map((action) => ({
      actionId: action.actionId, occurrenceId: action.occurrenceId, revision: action.revision, actionCode: action.actionCode,
      wallet: action.recipient, creatorId: action.creatorId, campaignId: action.campaignId, occurredDay: action.occurredDay,
      easUid: action.easUid, txHash: action.txHash, blockNumber: action.blockNumber.toString(), status: action.status,
      current: latest.get(action.occurrenceId.toLowerCase()) === action.revision && isTrustedCurrentAction(action, boundary),
      qa: qaOccurrences.has(action.occurrenceId.toLowerCase()), origin: action.origin,
      credentials: action.credentials.map(({kind,nftContract,tokenId,linkOrigin}) => ({kind,nftContract,tokenId,linkOrigin})),
    })),
    transactions: source.lifecycleTransactions.map((tx) => ({ txHash: tx.txHash, blockNumber: tx.blockNumber.toString(), kind: tx.kind, qa: qaTx(tx), origin: tx.origin })),
  };
}
