export interface PublicOnchainMetrics {
  uniqueActiveWallets: number;
  actionCounts: Record<number, number>;
  passportCredentials: number;
  mintedCredentials: number;
  lifecycleTransactions: number;
  currentActionTransactions: number;
}
export interface PublicOnchainAction {
  actionId: string; occurrenceId: string; revision: number; actionCode: number;
  wallet: string; creatorId: string; campaignId: string; occurredDay: number;
  easUid: string; txHash: string; blockNumber: string;
  status: "ACTIVE" | "INVALIDATED"; current: boolean; qa: boolean; origin: "NATIVE" | "HISTORICAL";
  credentials: { kind: number; nftContract: string; tokenId: string; linkOrigin: number }[];
}
export interface PublicOnchainSnapshot {
  version: 1;
  network: string; chainId: number; hubAddress: string; environmentId: string; schemaUid: string;
  fromBlock: string; blockNumber: string; blockHash: string; blockTimestamp: string; generatedAt: string;
  business: PublicOnchainMetrics;
  raw: PublicOnchainMetrics;
  excludedQaWallets: string[];
  excludedQaActions: number;
  historicalActions: number;
  actions: PublicOnchainAction[];
  transactions: { txHash: string; blockNumber: string; kind: "record" | "invalidate" | "correct"; qa: boolean; origin: "NATIVE" | "HISTORICAL" }[];
}
export type PublicOnchainResult = { state: "available"; snapshot: PublicOnchainSnapshot } | { state: "unavailable" };
