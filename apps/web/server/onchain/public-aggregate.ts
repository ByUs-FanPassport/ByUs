import { getAddress } from "viem";
import { aggregateFanActionMetrics, isTrustedCurrentAction } from "../../../worker/src/action-metrics";
import type { FinalizedActionSnapshot } from "../../../worker/src/action-public-snapshot";
import { onchainConfig } from "./public-config";
import type { PublicOnchainSnapshot } from "./public-types";

/** Pure projection: every metric input comes from the validated chain snapshot. */
export function projectPublicOnchainSnapshot(source: FinalizedActionSnapshot, generatedAt = new Date()): PublicOnchainSnapshot {
  const hubProxies = source.deployments.map(({ hubAddress }) => hubAddress);
  const boundary = {
    chainId: onchainConfig.chainId, environmentId: onchainConfig.environmentId,
    hubProxy: onchainConfig.hubAddress, hubProxies, schemaUid: onchainConfig.schemaUid,
    asOfEpochSeconds: source.timestamp,
  };
  const qaWallets = new Set<string>(onchainConfig.qaWallets.map((wallet) => wallet.toLowerCase()));
  // sourceOccurrence is stable across revisions and deployments; exclude its whole history if any recipient is QA.
  const qaSources = new Set(source.actions
    .filter((action) => qaWallets.has(action.recipient.toLowerCase()))
    .map((action) => action.sourceOccurrence.toLowerCase()));
  const qaActionIds = new Set(source.actions
    .filter((action) => qaSources.has(action.sourceOccurrence.toLowerCase()))
    .map((action) => action.actionId.toLowerCase()));
  const qaTx = (tx: FinalizedActionSnapshot["lifecycleTransactions"][number]) => tx.recipients.some((wallet) => qaWallets.has(wallet.toLowerCase()))
    || tx.actionIds.some((id) => qaActionIds.has(id.toLowerCase()));
  const businessActions = source.actions.filter((action) => !qaSources.has(action.sourceOccurrence.toLowerCase()) && action.origin === "NATIVE");
  const collision = source.sourceCollisions.length > 0;
  const businessMetrics = collision ? null : aggregateFanActionMetrics(businessActions, boundary);
  const raw = aggregateFanActionMetrics(source.actions, boundary, { includeHistorical: true });
  const latest = new Map<string, number>();
  for (const action of source.actions) {
    const key = `${getAddress(action.hubProxy).toLowerCase()}:${action.occurrenceId.toLowerCase()}`;
    latest.set(key, Math.max(latest.get(key) ?? 0, action.revision));
  }
  const metrics = (value: typeof raw, lifecycleTransactions: number) => ({
    uniqueActiveWallets: value.uniqueActiveWallets, actionCounts: value.actionCounts,
    passportCredentials: value.passportCredentials, mintedCredentials: value.mintedCredentials,
    currentActionTransactions: value.transactions, lifecycleTransactions,
  });
  const deploymentNames = new Map(source.deployments.map((deployment) => [getAddress(deployment.hubAddress).toLowerCase(), deployment.label]));
  const configuredDeployments = new Map(onchainConfig.deployments.map((deployment) => [getAddress(deployment.hubAddress).toLowerCase(), deployment]));
  const projected: PublicOnchainSnapshot = {
    version: 2, network: onchainConfig.network, chainId: onchainConfig.chainId, hubAddress: onchainConfig.hubAddress,
    environmentId: onchainConfig.environmentId, schemaUid: onchainConfig.schemaUid,
    fromBlock: onchainConfig.fromBlock.toString(), blockNumber: source.blockNumber.toString(), blockHash: source.blockHash,
    blockTimestamp: new Date(Number(source.timestamp) * 1000).toISOString(), generatedAt: generatedAt.toISOString(),
    deployments: source.deployments.map((deployment) => {
      const configured = configuredDeployments.get(getAddress(deployment.hubAddress).toLowerCase());
      if (!configured) throw new Error("Action public projection received an unconfigured Hub deployment");
      return {
        label: deployment.label, hubAddress: getAddress(deployment.hubAddress), fromBlock: deployment.fromBlock.toString(),
        actionCount: deployment.actionCount, writeStatus: configured.writeStatus,
      };
    }),
    business: businessMetrics ? metrics(businessMetrics, source.lifecycleTransactions.filter((tx) => !qaTx(tx) && tx.origin === "NATIVE").length) : null,
    raw: metrics(raw, source.lifecycleTransactions.length),
    excludedQaWallets: [...onchainConfig.qaWallets], excludedQaActions: qaSources.size, historicalActions: raw.historicalActions,
    actions: source.actions.map((action) => {
      const latestKey = `${getAddress(action.hubProxy).toLowerCase()}:${action.occurrenceId.toLowerCase()}`;
      return {
        actionId: action.actionId, occurrenceId: action.occurrenceId, sourceOccurrence: action.sourceOccurrence,
        revision: action.revision, actionCode: action.actionCode, wallet: action.recipient,
        creatorId: action.creatorId, campaignId: action.campaignId, occurredDay: action.occurredDay,
        easUid: action.easUid, txHash: action.txHash, blockNumber: action.blockNumber.toString(),
        hubAddress: getAddress(action.hubProxy), environmentId: action.environmentId,
        sourceDeployment: deploymentNames.get(getAddress(action.hubProxy).toLowerCase()) ?? "ActionHub",
        status: action.status,
        current: latest.get(latestKey) === action.revision && isTrustedCurrentAction(action, boundary),
        qa: qaSources.has(action.sourceOccurrence.toLowerCase()), origin: action.origin,
        credentials: action.credentials.map(({ kind, nftContract, tokenId, linkOrigin }) => ({ kind, nftContract, tokenId, linkOrigin })),
      };
    }),
    transactions: source.lifecycleTransactions.map((tx) => ({
      txHash: tx.txHash, blockNumber: tx.blockNumber.toString(), hubAddress: getAddress(tx.hubProxy),
      kind: tx.kind, qa: qaTx(tx), origin: tx.origin,
    })),
  };
  if (collision) projected.businessUnavailableReason = "cross_hub_source_collision";
  return projected;
}
