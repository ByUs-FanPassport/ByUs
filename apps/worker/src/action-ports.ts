import type { PreparedSubmission } from "./domain.js";
import type { CanonicalActionPayloadV1, FanActionJob } from "./action-domain.js";

export interface ActionQueuePort {
  claim(workerId: string, batchSize: number, leaseSeconds: number): Promise<FanActionJob[]>;
  admitDispatch(job: FanActionJob): Promise<boolean>;
  admitWriter(job: FanActionJob, chainId: number, relayer: string, leaseSeconds: number): Promise<boolean>;
  releaseWriter(job: FanActionJob, chainId: number, relayer: string): Promise<void>;
  prepareCanonical(job: FanActionJob, payload: CanonicalActionPayloadV1): Promise<FanActionJob>;
  recordPrepared(job: FanActionJob, submission: PreparedSubmission): Promise<FanActionJob>;
  complete(job: FanActionJob, receipt: ActionReceipt): Promise<void>;
  retry(job: FanActionJob, code: string, message: string, retryable: boolean): Promise<void>;
}

export interface ActionMetadataPort {
  pin(document: import("./ports.js").MetadataDocument, operationKey: string): Promise<string>;
}

export interface ActionHashResult {
  occurrenceId: string;
  actionId: string;
  requestHash: string;
}

export interface ActionCredentialReceipt {
  kind: number;
  nftContract: string;
  tokenId: bigint;
  issuanceKey: string;
  metadataUri: string;
  linkOrigin: number;
  logIndex: number;
}

export interface ActionReceipt {
  txHash: string;
  blockNumber: bigint;
  blockHash: string;
  transactionIndex: number;
  hubLogIndex: number;
  easUid: string;
  recordHash: string;
  credentialRefsHash: string;
  credentials: ActionCredentialReceipt[];
  inclusionStatus: "included";
}

export interface ActionChainPort {
  readonly relayerAddress: string;
  canonicalHashes(payload: Omit<CanonicalActionPayloadV1, "occurrenceId" | "actionId" | "requestHash" | "workerSubmission">): Promise<ActionHashResult>;
  findExisting(payload: CanonicalActionPayloadV1): Promise<ActionReceipt | null>;
  prepare(payload: CanonicalActionPayloadV1): Promise<PreparedSubmission>;
  broadcast(signedTransaction: string): Promise<string>;
  receipt(payload: CanonicalActionPayloadV1, submission: PreparedSubmission): Promise<ActionReceipt | null>;
}
