import { keccak256, toBytes } from "viem";
import { z } from "zod";

const uuidSchema = z.uuid();
const celebritySlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
const recipientSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export type BlockchainQueueStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "RETRYING"
  | "FAILED";

export type CredentialMintStatus =
  | "queued"
  | "processing"
  | "minted"
  | "retryable"
  | "permanent_failure";

export interface PassportJobSpec {
  entityType: "passport";
  entityId: string;
  operationKey: string;
  payloadVersion: 1;
  payload: {
    recipient: string;
    celebritySlug: string;
    passportId: `0x${string}`;
  };
}

export interface KnowledgeStampJobSpec {
  entityType: "stamp";
  entityId: string;
  operationKey: string;
  payloadVersion: 1;
  payload: {
    recipient: string;
    celebritySlug: string;
    issuanceId: `0x${string}`;
    stampType: "Knowledge";
  };
}

function credentialId(operationKey: string): `0x${string}` {
  return keccak256(toBytes(operationKey));
}

export function buildPassportJob(input: {
  appUserId: string;
  passportRecordId: string;
  celebritySlug: string;
  recipient: string;
}): PassportJobSpec {
  const appUserId = uuidSchema.parse(input.appUserId);
  const entityId = uuidSchema.parse(input.passportRecordId);
  const celebritySlug = celebritySlugSchema.parse(input.celebritySlug);
  const recipient = recipientSchema.parse(input.recipient);
  const operationKey = `byus:passport:v1:${appUserId}:${celebritySlug}`;

  return {
    entityType: "passport",
    entityId,
    operationKey,
    payloadVersion: 1,
    payload: { recipient, celebritySlug, passportId: credentialId(operationKey) },
  };
}

export function buildKnowledgeStampJob(input: {
  stampId: string;
  celebritySlug: string;
  recipient: string;
}): KnowledgeStampJobSpec {
  const entityId = uuidSchema.parse(input.stampId);
  const celebritySlug = celebritySlugSchema.parse(input.celebritySlug);
  const recipient = recipientSchema.parse(input.recipient);
  const operationKey = `byus:stamp:v1:${entityId}`;

  return {
    entityType: "stamp",
    entityId,
    operationKey,
    payloadVersion: 1,
    payload: {
      recipient,
      celebritySlug,
      issuanceId: credentialId(operationKey),
      stampType: "Knowledge",
    },
  };
}

const mintStatusByQueueStatus: Record<BlockchainQueueStatus, CredentialMintStatus> = {
  PENDING: "queued",
  PROCESSING: "processing",
  COMPLETED: "minted",
  RETRYING: "retryable",
  FAILED: "permanent_failure",
};

export function mapQueueStatusToMintStatus(status: BlockchainQueueStatus): CredentialMintStatus {
  return mintStatusByQueueStatus[status];
}
