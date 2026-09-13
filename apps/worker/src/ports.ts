import type { BlockchainJob, EntityType, JobPayload, PreparedSubmission } from "./domain.js";

export interface QueuePort {
  claim(workerId: string, batchSize: number, leaseSeconds: number): Promise<BlockchainJob[]>;
  admitMint(job: BlockchainJob): Promise<boolean>;
  admitWriter(job: BlockchainJob, chainId: number, relayer: string, leaseSeconds: number): Promise<boolean>;
  releaseWriter(job: BlockchainJob, chainId: number, relayer: string): Promise<void>;
  holdFeePolicy(job: BlockchainJob): Promise<void>;
  recordPrepared(job: BlockchainJob, submission: PreparedSubmission): Promise<BlockchainJob>;
  complete(job: BlockchainJob, txHash: string, tokenId: bigint): Promise<void>;
  retry(job: BlockchainJob, code: string, message: string, retryable: boolean): Promise<void>;
}

export interface MetadataDocument {
  schema: "https://byus.kr/schemas/credential-metadata-v1.json" | "https://byus.kr/schemas/credential-metadata-v2.json";
  version: 1 | 2;
  name: string;
  description: string;
  image: string;
  attributes: ReadonlyArray<{ trait_type: string; value: string }>;
}

export interface MetadataPort {
  pin(document: MetadataDocument, operationKey: string): Promise<string>;
}

export interface PreparedMint extends PreparedSubmission {}

export interface MintReceipt {
  txHash: string;
  tokenId: bigint;
}

export interface ChainPort {
  readonly chainId: number;
  readonly relayerAddress: string;
  findExisting(entityType: EntityType, payload: JobPayload): Promise<MintReceipt | null>;
  prepare(entityType: EntityType, payload: JobPayload, metadataUri: string): Promise<PreparedMint>;
  broadcast(signedTransaction: string): Promise<string>;
  receipt(txHash: string, entityType: EntityType, payload: JobPayload, submission: PreparedSubmission): Promise<MintReceipt | null>;
}

export interface ClockPort {
  sleep(milliseconds: number): Promise<void>;
}
