export interface PublicOnchainMetrics {
  uniqueActiveWallets: number;
  actionCounts: Record<number, number>;
  passportCredentials: number;
  mintedCredentials: number;
  lifecycleTransactions: number;
  currentActionTransactions: number;
}
export interface PublicOnchainAction {
  actionId: string; occurrenceId: string; sourceOccurrence: string; revision: number; actionCode: number;
  wallet: string; creatorId: string; campaignId: string; occurredDay: number;
  easUid: string; txHash: string; blockNumber: string; hubAddress: string; environmentId: string; sourceDeployment: string;
  status: "ACTIVE" | "INVALIDATED"; current: boolean; qa: boolean; origin: "NATIVE" | "HISTORICAL";
  credentials: { kind: number; nftContract: string; tokenId: string; linkOrigin: number }[];
}
export interface PublicOnchainSnapshot {
  version: 2;
  network: string; chainId: number; hubAddress: string; environmentId: string; schemaUid: string;
  fromBlock: string; blockNumber: string; blockHash: string; blockTimestamp: string; generatedAt: string;
  deployments: { label: string; hubAddress: string; fromBlock: string; actionCount: number; writeStatus: "historical" | "current" | "pending_activation" }[];
  business: PublicOnchainMetrics | null;
  businessUnavailableReason?: "cross_hub_source_collision";
  raw: PublicOnchainMetrics;
  excludedQaWallets: string[];
  excludedQaActions: number;
  historicalActions: number;
  actions: PublicOnchainAction[];
  transactions: { txHash: string; blockNumber: string; hubAddress: string; kind: "record" | "invalidate" | "correct"; qa: boolean; origin: "NATIVE" | "HISTORICAL" }[];
}
export type PublicOnchainResult = { state: "available"; snapshot: PublicOnchainSnapshot } | { state: "unavailable" };
