const requestComponents = [
  { name: "sourceOccurrence", type: "bytes32" }, { name: "revision", type: "uint32" },
  { name: "actionCode", type: "uint16" }, { name: "schemaVersion", type: "uint16" },
  { name: "policyVersion", type: "uint32" }, { name: "fan", type: "address" },
  { name: "creatorId", type: "bytes32" }, { name: "campaignId", type: "bytes32" },
  { name: "occurredDay", type: "uint32" }, { name: "evidenceCommitment", type: "bytes32" },
  { name: "migrationBatchId", type: "bytes32" }, { name: "bindingVersion", type: "uint32" },
] as const;

const intentComponents = [
  { name: "kind", type: "uint8" }, { name: "mode", type: "uint8" },
  { name: "issuanceKey", type: "bytes32" }, { name: "tokenId", type: "uint256" },
  { name: "metadataUri", type: "string" },
] as const;

const actionRecordComponents = [
  { name: "occurrenceId", type: "bytes32" }, { name: "actionId", type: "bytes32" },
  { name: "easUID", type: "bytes32" }, { name: "requestHash", type: "bytes32" },
  { name: "recordHash", type: "bytes32" }, { name: "schemaUID", type: "bytes32" },
  { name: "refUID", type: "bytes32" }, { name: "fan", type: "address" },
  { name: "revision", type: "uint32" }, { name: "actionCode", type: "uint16" },
  { name: "schemaVersion", type: "uint16" }, { name: "policyVersion", type: "uint32" },
  { name: "status", type: "uint8" }, { name: "origin", type: "uint8" },
  { name: "migrationBatchId", type: "bytes32" },
] as const;

export const credentialRefComponents = [
  { name: "nftContract", type: "address" }, { name: "tokenId", type: "uint256" },
  { name: "kind", type: "uint8" }, { name: "issuanceKey", type: "bytes32" },
  { name: "linkOrigin", type: "uint8" },
] as const;

export const actionHubAbi = [
  { type: "function", name: "recordOnly", stateMutability: "nonpayable", inputs: [{ name: "req", type: "tuple", components: requestComponents }], outputs: [{ name: "result", type: "tuple", components: [{ name: "actionId", type: "bytes32" }, { name: "easUID", type: "bytes32" }, { name: "requestHash", type: "bytes32" }, { name: "recordHash", type: "bytes32" }] }] },
  { type: "function", name: "recordAndIssue", stateMutability: "nonpayable", inputs: [{ name: "req", type: "tuple", components: requestComponents }, { name: "intents", type: "tuple[]", components: intentComponents }], outputs: [{ name: "result", type: "tuple", components: [{ name: "actionId", type: "bytes32" }, { name: "easUID", type: "bytes32" }, { name: "requestHash", type: "bytes32" }, { name: "recordHash", type: "bytes32" }] }] },
  { type: "function", name: "importHistorical", stateMutability: "nonpayable", inputs: [{ name: "req", type: "tuple", components: requestComponents }, { name: "intents", type: "tuple[]", components: intentComponents }, { name: "proof", type: "bytes32[]" }], outputs: [{ name: "result", type: "tuple", components: [{ name: "actionId", type: "bytes32" }, { name: "easUID", type: "bytes32" }, { name: "requestHash", type: "bytes32" }, { name: "recordHash", type: "bytes32" }] }] },
  { type: "function", name: "computeOccurrenceId", stateMutability: "view", inputs: [{ name: "sourceOccurrence", type: "bytes32" }], outputs: [{ name: "", type: "bytes32" }] },
  { type: "function", name: "computeActionId", stateMutability: "pure", inputs: [{ name: "occurrenceId", type: "bytes32" }, { name: "revision", type: "uint32" }], outputs: [{ name: "", type: "bytes32" }] },
  { type: "function", name: "hashRequest", stateMutability: "view", inputs: [{ name: "operation", type: "uint8" }, { name: "req", type: "tuple", components: requestComponents }, { name: "intents", type: "tuple[]", components: intentComponents }], outputs: [{ name: "", type: "bytes32" }] },
  { type: "function", name: "getAction", stateMutability: "view", inputs: [{ name: "actionId", type: "bytes32" }], outputs: [{ name: "", type: "tuple", components: actionRecordComponents }] },
  { type: "function", name: "latestActionId", stateMutability: "view", inputs: [{ name: "occurrenceId", type: "bytes32" }], outputs: [{ name: "", type: "bytes32" }] },
  { type: "function", name: "getSchema", stateMutability: "view", inputs: [{ name: "schemaVersion", type: "uint16" }], outputs: [{ name: "", type: "bytes32" }] },
  { type: "function", name: "getAssetBinding", stateMutability: "view", inputs: [{ name: "bindingVersion", type: "uint32" }, { name: "kind", type: "uint8" }], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "eas", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "environmentId", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bytes32" }] },
  { type: "event", name: "FanActionRecorded", inputs: [{ indexed: true, name: "actionId", type: "bytes32" }, { indexed: true, name: "fan", type: "address" }, { indexed: true, name: "campaignId", type: "bytes32" }, { indexed: false, name: "occurrenceId", type: "bytes32" }, { indexed: false, name: "revision", type: "uint32" }, { indexed: false, name: "creatorId", type: "bytes32" }, { indexed: false, name: "actionName", type: "string" }, { indexed: false, name: "schemaVersion", type: "uint16" }, { indexed: false, name: "policyVersion", type: "uint32" }, { indexed: false, name: "easUID", type: "bytes32" }, { indexed: false, name: "occurredDay", type: "uint32" }, { indexed: false, name: "origin", type: "uint8" }, { indexed: false, name: "migrationBatchId", type: "bytes32" }] },
  { type: "event", name: "CredentialLinked", inputs: [{ indexed: true, name: "actionId", type: "bytes32" }, { indexed: true, name: "nftContract", type: "address" }, { indexed: true, name: "tokenId", type: "uint256" }, { indexed: false, name: "credentialKind", type: "uint8" }, { indexed: false, name: "issuanceKey", type: "bytes32" }, { indexed: false, name: "linkOrigin", type: "uint8" }] },
  { type: "event", name: "FanActionInvalidated", inputs: [{ indexed: true, name: "actionId", type: "bytes32" }, { indexed: true, name: "easUID", type: "bytes32" }, { indexed: false, name: "reasonCode", type: "uint16" }] },
  { type: "event", name: "FanActionCorrected", inputs: [{ indexed: true, name: "previousActionId", type: "bytes32" }, { indexed: true, name: "newActionId", type: "bytes32" }, { indexed: true, name: "occurrenceId", type: "bytes32" }] },
  { type: "function", name: "invalidate", stateMutability: "nonpayable", inputs: [{ name: "actionId", type: "bytes32" }, { name: "reasonCode", type: "uint16" }], outputs: [{ name: "changed", type: "bool" }] },
  { type: "function", name: "correct", stateMutability: "nonpayable", inputs: [{ name: "expectedPreviousActionId", type: "bytes32" }, { name: "req", type: "tuple", components: requestComponents }, { name: "linkExisting", type: "tuple[]", components: intentComponents }], outputs: [{ name: "result", type: "tuple", components: [{ name: "actionId", type: "bytes32" }, { name: "easUID", type: "bytes32" }, { name: "requestHash", type: "bytes32" }, { name: "recordHash", type: "bytes32" }] }] },
] as const;

export const easAbi = [
  { type: "function", name: "isAttestationValid", stateMutability: "view", inputs: [{ name: "uid", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "getAttestation", stateMutability: "view", inputs: [{ name: "uid", type: "bytes32" }], outputs: [{ name: "", type: "tuple", components: [{ name: "uid", type: "bytes32" }, { name: "schema", type: "bytes32" }, { name: "time", type: "uint64" }, { name: "expirationTime", type: "uint64" }, { name: "revocationTime", type: "uint64" }, { name: "refUID", type: "bytes32" }, { name: "recipient", type: "address" }, { name: "attester", type: "address" }, { name: "revocable", type: "bool" }, { name: "data", type: "bytes" }] }] },
] as const;

export const erc721TransferAbi = [{ type: "event", name: "Transfer", inputs: [{ indexed: true, name: "from", type: "address" }, { indexed: true, name: "to", type: "address" }, { indexed: true, name: "tokenId", type: "uint256" }] }] as const;
export const erc1155TransferAbi = [
  { type: "event", name: "TransferSingle", inputs: [{ indexed: true, name: "operator", type: "address" }, { indexed: true, name: "from", type: "address" }, { indexed: true, name: "to", type: "address" }, { indexed: false, name: "id", type: "uint256" }, { indexed: false, name: "value", type: "uint256" }] },
  { type: "event", name: "TransferBatch", inputs: [{ indexed: true, name: "operator", type: "address" }, { indexed: true, name: "from", type: "address" }, { indexed: true, name: "to", type: "address" }, { indexed: false, name: "ids", type: "uint256[]" }, { indexed: false, name: "values", type: "uint256[]" }] },
] as const;
