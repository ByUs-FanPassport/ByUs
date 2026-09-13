import { getAddress, type Address, type Hash } from "viem";
import {
  actionSourceSnapshotV1Schema,
  intentModes,
  legacyMetadataInput,
  localActionId,
  localOccurrenceId,
  occurredDay,
  operationKind,
  sourceOccurrenceId,
  sourceCredentialIssuanceKey,
  sortCanonicalIntents,
  type ActionSourceSnapshotV1,
  type CanonicalActionPayloadV1,
  type FanActionJob,
} from "./action-domain.js";
import { renderMetadata } from "./metadata.js";
import type { ActionChainPort, ActionMetadataPort } from "./action-ports.js";
import { WorkerError } from "./domain.js";
import type { MetadataDocument } from "./ports.js";

const actionNames: Record<number, string> = {
  1: "FAN_VERIFIED", 2: "LIVE_RESERVED", 3: "LIVE_ATTENDED", 4: "MISSION_COMPLETED",
  5: "SURVEY_SUBMITTED", 6: "FIRST_REACTION", 7: "WELCOME_COMPLETED", 8: "FIRST_COMMENT",
  9: "INVITE_COMPLETED", 10: "DAILY_CHECKIN", 11: "COLLECTIBLE_CLAIMED",
};

export function renderActionMetadata(document: MetadataDocument, actionCode: number, schemaVersion: number): MetadataDocument {
  const actionName = actionNames[actionCode];
  if (!actionName) throw new WorkerError("UNSUPPORTED_ACTION_CODE", `Unsupported action code ${actionCode}`, false);
  const attributes = document.attributes.filter((attribute) => attribute.trait_type !== "Metadata Version").map((attribute) => {
    if (actionCode === 4 && attribute.trait_type === "Credential") return { ...attribute, value: "Mission Completion Stamp" };
    return attribute;
  });
  attributes.push(
    { trait_type: "Action", value: actionName },
    { trait_type: "Action Schema Version", value: String(schemaVersion) },
    { trait_type: "Metadata Version", value: "2" },
  );
  return {
    ...document,
    schema: "https://byus.kr/schemas/credential-metadata-v2.json",
    version: 2,
    ...(actionCode === 4 ? { name: "ByUs Mission Completion Stamp", description: "A soulbound ByUs Mission Completion Stamp credential." } : {}),
    attributes,
  };
}

export async function buildCanonicalActionPayload(
  job: FanActionJob,
  rawSnapshot: unknown,
  metadata: ActionMetadataPort,
  chain: ActionChainPort,
  nowMs = Date.now(),
): Promise<CanonicalActionPayloadV1> {
  const snapshot = actionSourceSnapshotV1Schema.parse(rawSnapshot);
  const sourceOccurrence = sourceOccurrenceId(snapshot.sourceNamespace, snapshot.canonicalSourceKey);
  const localOccurrence = localOccurrenceId(snapshot.chainId, snapshot.hubProxy as Address, snapshot.environmentId as Hash, sourceOccurrence);
  const localAction = localActionId(localOccurrence, snapshot.revision);
  const intents = [];
  for (const credential of snapshot.credentials) {
    let metadataUri = credential.expectedMetadataUri ?? "";
    if (credential.mode === "MINT") {
      const metadataInput = legacyMetadataInput(credential.metadata!);
      const syntheticJob = {
        id: job.id,
        entityType: metadataInput.entityType,
        entityId: job.occurrenceRowId,
        operationKey: metadataInput.operationKey,
        payloadVersion: 1,
        payload: metadataInput.payload,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        txHash: null,
        leaseOwner: job.leaseOwner,
        leaseExpiresAt: job.leaseExpiresAt,
      } as const;
      const document = renderActionMetadata(renderMetadata(syntheticJob, metadataInput.payload, snapshot.assetBaseUri), snapshot.actionCode, snapshot.schemaVersion);
      metadataUri = await metadata.pin(document, metadataInput.operationKey);
    }
    intents.push({
      kind: credential.kind,
      mode: credential.mode === "MINT" ? intentModes.MINT : intentModes.LINK_EXISTING,
      nftContract: getAddress(credential.nftContract),
      issuanceKey: sourceCredentialIssuanceKey(credential),
      tokenId: credential.existingTokenId ?? "0",
      metadataUri,
    });
  }
  const sorted = sortCanonicalIntents(intents);
  const base = {
    version: 1 as const,
    chainId: snapshot.chainId,
    environmentId: snapshot.environmentId,
    hubProxy: getAddress(snapshot.hubProxy),
    schemaUid: snapshot.schemaUid,
    operation: operationKind(snapshot.operationKind),
    request: {
      sourceOccurrence,
      revision: snapshot.revision,
      actionCode: snapshot.actionCode,
      schemaVersion: snapshot.schemaVersion,
      policyVersion: snapshot.policyVersion,
      fan: getAddress(snapshot.recipient),
      creatorId: snapshot.creatorId,
      campaignId: snapshot.campaignId,
      occurredDay: occurredDay(snapshot.sourceOccurredAt, nowMs),
      evidenceCommitment: snapshot.evidenceCommitment,
      migrationBatchId: snapshot.migrationBatchId,
      bindingVersion: snapshot.bindingVersion,
    },
    intents: sorted,
    migrationProof: snapshot.migrationProof,
  };
  const hashes = await chain.canonicalHashes(base);
  if (hashes.occurrenceId.toLowerCase() !== localOccurrence.toLowerCase()) {
    throw new WorkerError("HUB_OCCURRENCE_ID_MISMATCH", "Hub occurrence id differs from the canonical worker domain", false);
  }
  if (hashes.actionId.toLowerCase() !== localAction.toLowerCase()) {
    throw new WorkerError("HUB_ACTION_ID_MISMATCH", "Hub action id differs from the canonical worker domain", false);
  }
  return { ...base, occurrenceId: hashes.occurrenceId, actionId: hashes.actionId, requestHash: hashes.requestHash };
}

export function assertSnapshotMatchesCanonical(snapshotInput: unknown, payload: CanonicalActionPayloadV1): void {
  const snapshot: ActionSourceSnapshotV1 = actionSourceSnapshotV1Schema.parse(snapshotInput);
  const expectedSourceOccurrence = sourceOccurrenceId(snapshot.sourceNamespace, snapshot.canonicalSourceKey);
  const expectedOccurrence = localOccurrenceId(snapshot.chainId, snapshot.hubProxy as Address, snapshot.environmentId as Hash, expectedSourceOccurrence);
  const expectedAction = localActionId(expectedOccurrence, snapshot.revision);
  const expectedOperation = operationKind(snapshot.operationKind);
  if (snapshot.chainId !== payload.chainId
    || getAddress(snapshot.hubProxy) !== getAddress(payload.hubProxy)
    || snapshot.environmentId.toLowerCase() !== payload.environmentId.toLowerCase()
    || snapshot.schemaUid.toLowerCase() !== payload.schemaUid.toLowerCase()
    || snapshot.schemaVersion !== payload.request.schemaVersion
    || snapshot.bindingVersion !== payload.request.bindingVersion
    || getAddress(snapshot.recipient) !== getAddress(payload.request.fan)
    || payload.request.sourceOccurrence.toLowerCase() !== expectedSourceOccurrence.toLowerCase()
    || payload.occurrenceId.toLowerCase() !== expectedOccurrence.toLowerCase()
    || payload.actionId.toLowerCase() !== expectedAction.toLowerCase()
    || payload.operation !== expectedOperation
    || payload.request.revision !== snapshot.revision
    || payload.request.actionCode !== snapshot.actionCode
    || payload.request.policyVersion !== snapshot.policyVersion
    || payload.request.creatorId.toLowerCase() !== snapshot.creatorId.toLowerCase()
    || payload.request.campaignId.toLowerCase() !== snapshot.campaignId.toLowerCase()
    || payload.request.occurredDay !== occurredDay(snapshot.sourceOccurredAt)
    || payload.request.evidenceCommitment.toLowerCase() !== snapshot.evidenceCommitment.toLowerCase()
    || payload.request.migrationBatchId.toLowerCase() !== snapshot.migrationBatchId.toLowerCase()
    || JSON.stringify(payload.migrationProof.map((item) => item.toLowerCase())) !== JSON.stringify(snapshot.migrationProof.map((item) => item.toLowerCase()))) {
    throw new WorkerError("ACTION_CANONICAL_SNAPSHOT_MISMATCH", "Canonical action payload no longer matches its immutable source snapshot", false);
  }
  if (payload.intents.length !== snapshot.credentials.length) throw new WorkerError("ACTION_CANONICAL_SNAPSHOT_MISMATCH", "Canonical credential count differs from source snapshot", false);
  for (const credential of snapshot.credentials) {
    const issuanceKey = sourceCredentialIssuanceKey(credential);
    const intent = payload.intents.find((item) => item.kind === credential.kind && item.issuanceKey.toLowerCase() === issuanceKey.toLowerCase());
    const expectedMode = credential.mode === "MINT" ? intentModes.MINT : intentModes.LINK_EXISTING;
    if (!intent || intent.mode !== expectedMode || getAddress(intent.nftContract) !== getAddress(credential.nftContract)
      || intent.tokenId !== (credential.existingTokenId ?? "0") || !intent.metadataUri
      || (credential.mode === "LINK_EXISTING" && intent.metadataUri !== credential.expectedMetadataUri)) {
      throw new WorkerError("ACTION_CANONICAL_SNAPSHOT_MISMATCH", `Canonical credential ${issuanceKey} differs from source snapshot`, false);
    }
  }
}
