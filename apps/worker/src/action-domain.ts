import { encodeAbiParameters, getAddress, keccak256, stringToHex, type Address, type Hash } from "viem";
import { z } from "zod";
import {
  addressSchema,
  bytes32Schema,
  parseJobPayload,
  signedTransactionSchema,
  type BlockchainJob,
  type EntityType,
  type JobPayload,
  WorkerError,
} from "./domain.js";
import { actionCodes, linkOrigins } from "./action-constants.js";
export { actionCodes, linkOrigins } from "./action-constants.js";

export const ACTION_PAYLOAD_VERSION = 1 as const;
export type ActionCode = (typeof actionCodes)[keyof typeof actionCodes];
export const operationKinds = { RECORD_ONLY: 0, RECORD_AND_ISSUE: 1, IMPORT_HISTORICAL: 2, CORRECT: 3 } as const;
export const origins = { NATIVE: 0, HISTORICAL: 1 } as const;
export const credentialKinds = { PASSPORT: 0, STAMP: 1, COLLECTIBLE: 2 } as const;
export const intentModes = { MINT: 0, LINK_EXISTING: 1 } as const;

const uint16 = z.number().int().min(0).max(65_535);
const uint32 = z.number().int().min(0).max(4_294_967_295);
const uint8 = z.number().int().min(0).max(255);
const decimalUint = z.string().regex(/^(0|[1-9][0-9]*)$/);
const sourceNamespace = z.string().regex(/^[a-z][a-z0-9_]{1,62}$/);
const sourceKey = z.string().min(1).max(240);

const actionCodeSchema = z.union([
  z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6),
  z.literal(7), z.literal(8), z.literal(9), z.literal(10), z.literal(11),
]);
const entityTypeSchema = z.enum(["passport", "stamp", "reaction", "collectible", "community_stamp"]);

const metadataDescriptorSchema = z.object({
  operationKey: z.string().min(1).max(300),
  legacyEntityType: entityTypeSchema,
  legacyPayload: z.unknown(),
}).strict();

const sourceCredentialSchema = z.object({
  kind: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  nftContract: addressSchema,
  issuanceKey: bytes32Schema.nullable(),
  mode: z.enum(["MINT", "LINK_EXISTING"]),
  existingTokenId: decimalUint.optional(),
  expectedMetadataUri: z.string().min(1).max(1_000).optional(),
  metadata: metadataDescriptorSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.mode === "MINT" && !value.metadata) {
    context.addIssue({ code: "custom", path: ["metadata"], message: "MINT requires metadata inputs" });
  }
  if (value.mode === "MINT" && value.existingTokenId !== undefined) {
    context.addIssue({ code: "custom", path: ["existingTokenId"], message: "MINT cannot include an existing token id" });
  }
  if (value.mode === "LINK_EXISTING" && value.existingTokenId === undefined) {
    context.addIssue({ code: "custom", path: ["existingTokenId"], message: "LINK_EXISTING requires a token id" });
  }
  if (value.mode === "LINK_EXISTING" && !value.expectedMetadataUri) {
    context.addIssue({ code: "custom", path: ["expectedMetadataUri"], message: "LINK_EXISTING requires the verified metadata URI" });
  }
  if (value.mode === "LINK_EXISTING" && value.metadata !== undefined) {
    context.addIssue({ code: "custom", path: ["metadata"], message: "LINK_EXISTING must not repin metadata" });
  }
  if (value.issuanceKey === null && !(value.kind === credentialKinds.COLLECTIBLE && value.mode === "MINT" && value.metadata?.legacyEntityType === "collectible")) {
    context.addIssue({ code: "custom", path: ["issuanceKey"], message: "Only a new Collectible may derive its key from the immutable claim id" });
  }
});

export const actionSourceSnapshotV1Schema = z.object({
  version: z.literal(1),
  chainId: z.number().int().positive(),
  environmentId: bytes32Schema,
  hubProxy: addressSchema,
  schemaUid: bytes32Schema,
  schemaVersion: uint16,
  bindingVersion: uint32,
  operationKind: z.enum(["RECORD_ONLY", "RECORD_AND_ISSUE", "IMPORT_HISTORICAL"]),
  sourceNamespace,
  canonicalSourceKey: sourceKey,
  revision: uint32.min(1),
  actionCode: actionCodeSchema,
  policyVersion: uint32,
  recipient: addressSchema,
  creatorId: bytes32Schema,
  campaignId: bytes32Schema,
  sourceOccurredAt: z.iso.datetime({ offset: true }),
  origin: z.enum(["NATIVE", "HISTORICAL"]),
  evidenceCommitment: bytes32Schema,
  migrationBatchId: bytes32Schema,
  assetBaseUri: z.string().regex(/^ipfs:\/\/[a-zA-Z0-9]+(?:\/.*)?$/),
  credentials: z.array(sourceCredentialSchema).max(8),
  migrationProof: z.array(bytes32Schema).max(64).default([]),
}).strict().superRefine((value, context) => {
  const zero = `0x${"0".repeat(64)}`;
  if (value.origin === "NATIVE" && value.operationKind === "IMPORT_HISTORICAL") {
    context.addIssue({ code: "custom", path: ["origin"], message: "Historical imports require HISTORICAL origin" });
  }
  if (value.origin === "NATIVE" && value.migrationBatchId.toLowerCase() !== zero) {
    context.addIssue({ code: "custom", path: ["migrationBatchId"], message: "Native actions require a zero migration batch id" });
  }
  if (value.operationKind === "RECORD_ONLY" && value.credentials.length !== 0) {
    context.addIssue({ code: "custom", path: ["credentials"], message: "RECORD_ONLY cannot include credentials" });
  }
  if (value.operationKind !== "IMPORT_HISTORICAL" && value.migrationProof.length !== 0) {
    context.addIssue({ code: "custom", path: ["migrationProof"], message: "Only historical imports may include a manifest proof" });
  }
});

const canonicalIntentSchema = z.object({
  kind: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  mode: z.union([z.literal(0), z.literal(1)]),
  nftContract: addressSchema,
  issuanceKey: bytes32Schema,
  tokenId: decimalUint,
  metadataUri: z.string().max(1_000),
}).strict();

export const actionRequestSchema = z.object({
  sourceOccurrence: bytes32Schema,
  revision: uint32.min(1),
  actionCode: actionCodeSchema,
  schemaVersion: uint16,
  policyVersion: uint32,
  fan: addressSchema,
  creatorId: bytes32Schema,
  campaignId: bytes32Schema,
  occurredDay: uint32,
  evidenceCommitment: bytes32Schema,
  migrationBatchId: bytes32Schema,
  bindingVersion: uint32,
}).strict();

export const canonicalActionPayloadV1Schema = z.object({
  version: z.literal(1),
  chainId: z.number().int().positive(),
  environmentId: bytes32Schema,
  hubProxy: addressSchema,
  schemaUid: bytes32Schema,
  operation: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  request: actionRequestSchema,
  occurrenceId: bytes32Schema,
  actionId: bytes32Schema,
  intents: z.array(canonicalIntentSchema).max(8),
  migrationProof: z.array(bytes32Schema).max(64),
  requestHash: bytes32Schema,
  workerSubmission: z.object({ txHash: bytes32Schema, signedTransaction: signedTransactionSchema }).strict().optional(),
}).strict();

export type ActionSourceSnapshotV1 = z.infer<typeof actionSourceSnapshotV1Schema>;
export type CanonicalActionPayloadV1 = z.infer<typeof canonicalActionPayloadV1Schema>;
export type CanonicalCredentialIntent = z.infer<typeof canonicalIntentSchema>;

export interface FanActionJob {
  id: string;
  occurrenceRowId: string;
  payloadVersion: number;
  sourceSnapshot: unknown;
  payload: unknown | null;
  actionId: string | null;
  requestHash: string | null;
  attempts: number;
  maxAttempts: number;
  txHash: string | null;
  signedTransaction: string | null;
  leaseOwner: string;
  leaseExpiresAt: string;
}

export function parseActionSourceSnapshot(job: FanActionJob): ActionSourceSnapshotV1 {
  if (job.payloadVersion !== ACTION_PAYLOAD_VERSION) {
    throw new WorkerError("UNSUPPORTED_ACTION_PAYLOAD_VERSION", `Unsupported action payload version: ${job.payloadVersion}`, false);
  }
  return actionSourceSnapshotV1Schema.parse(job.sourceSnapshot);
}

export function parseCanonicalActionPayload(job: FanActionJob): CanonicalActionPayloadV1 | null {
  if (job.payload === null) return null;
  const payload = canonicalActionPayloadV1Schema.parse(job.payload);
  if (job.actionId && payload.actionId.toLowerCase() !== job.actionId.toLowerCase()) {
    throw new WorkerError("ACTION_JOB_ID_MISMATCH", "Stored action_id does not match canonical payload", false);
  }
  if (job.requestHash && payload.requestHash.toLowerCase() !== job.requestHash.toLowerCase()) {
    throw new WorkerError("ACTION_JOB_HASH_MISMATCH", "Stored request_hash does not match canonical payload", false);
  }
  if (job.signedTransaction && payload.workerSubmission && payload.workerSubmission.signedTransaction !== job.signedTransaction) {
    throw new WorkerError("ACTION_SIGNED_TRANSACTION_MISMATCH", "Stored signed transaction differs from canonical payload", false);
  }
  return payload;
}

export function sourceOccurrenceId(namespace: string, canonicalSourceKey: string): Hash {
  return keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "string" }],
    [sourceNamespace.parse(namespace), sourceKey.parse(canonicalSourceKey)],
  ));
}

export function localOccurrenceId(chainId: number, hubProxy: Address, environmentId: Hash, sourceOccurrence: Hash): Hash {
  return keccak256(encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }],
    [BigInt(chainId), getAddress(hubProxy), environmentId, sourceOccurrence],
  ));
}

export function localActionId(occurrenceId: Hash, revision: number): Hash {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint32" }], [occurrenceId, revision]));
}

export function operationKind(value: ActionSourceSnapshotV1["operationKind"]): 0 | 1 | 2 {
  return operationKinds[value];
}

export function originCode(value: ActionSourceSnapshotV1["origin"]): 0 | 1 {
  return origins[value];
}

export function occurredDay(iso: string, nowMs = Date.now()): number {
  const milliseconds = Date.parse(iso);
  if (!Number.isFinite(milliseconds)) throw new WorkerError("INVALID_OCCURRED_AT", "sourceOccurredAt is invalid", false);
  if (milliseconds > nowMs) throw new WorkerError("FUTURE_OCCURRED_AT", "sourceOccurredAt cannot be in the future", false);
  return Math.floor(milliseconds / 86_400_000);
}

export function legacyMetadataInput(input: z.infer<typeof metadataDescriptorSchema>): {
  operationKey: string; entityType: EntityType; payload: JobPayload;
} {
  const synthetic: BlockchainJob = {
    id: "00000000-0000-0000-0000-000000000000",
    entityType: input.legacyEntityType,
    entityId: "metadata",
    operationKey: input.operationKey,
    payloadVersion: 1,
    payload: input.legacyPayload,
    attempts: 0,
    maxAttempts: 1,
    txHash: null,
    leaseOwner: "metadata",
    leaseExpiresAt: new Date(0).toISOString(),
  };
  return { operationKey: input.operationKey, entityType: input.legacyEntityType, payload: parseJobPayload(synthetic) };
}

export function sourceCredentialIssuanceKey(credential: z.infer<typeof sourceCredentialSchema>): Hash {
  if (credential.issuanceKey !== null) return credential.issuanceKey as Hash;
  const metadata = legacyMetadataInput(credential.metadata!);
  if (metadata.entityType !== "collectible") throw new WorkerError("INVALID_COLLECTIBLE_KEY_SOURCE", "Collectible key derivation requires a collectible payload", false);
  const claimId = (metadata.payload as { claimId: string }).claimId;
  return keccak256(stringToHex(claimId.toLowerCase()));
}

export function sortCanonicalIntents(intents: readonly CanonicalCredentialIntent[]): CanonicalCredentialIntent[] {
  const sorted = [...intents].sort((a, b) => {
    const kindOrder = a.kind - b.kind;
    if (kindOrder !== 0) return kindOrder;
    const keyOrder = a.issuanceKey.localeCompare(b.issuanceKey);
    if (keyOrder !== 0) return keyOrder;
    return BigInt(a.tokenId) < BigInt(b.tokenId) ? -1 : BigInt(a.tokenId) > BigInt(b.tokenId) ? 1 : 0;
  });
  const keys = new Set<string>();
  for (const intent of sorted) {
    const key = `${intent.kind}:${intent.issuanceKey.toLowerCase()}:${intent.tokenId}`;
    if (keys.has(key)) throw new WorkerError("DUPLICATE_CREDENTIAL_INTENT", `Duplicate credential intent ${key}`, false);
    keys.add(key);
  }
  return sorted;
}
