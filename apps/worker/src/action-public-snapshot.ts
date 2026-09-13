import {
  createPublicClient,
  decodeAbiParameters,
  decodeEventLog,
  decodeFunctionData,
  defineChain,
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  http,
  keccak256,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import { actionHubAbi, easAbi, erc1155TransferAbi, erc721TransferAbi } from "./action-abi.ts";
import { actionCodes } from "./action-constants.ts";
import type { ActionLifecycleTransaction, FinalizedIndexedFanAction, IndexedCredential } from "./action-metrics.js";

const ZERO_HASH = `0x${"0".repeat(64)}` as Hash;
const ZERO_ADDRESS = `0x${"0".repeat(40)}` as Address;
const LOG_CHUNK_BLOCKS = 10_000n;
const MAX_SCAN_BLOCKS = 5_000_000n;
const MAX_HUB_LOGS = 50_000;
const MAX_ACTIONS = 10_000;
const MAX_EVENT_BLOCKS = 5_000;
const SNAPSHOT_DEADLINE_MS = 45_000;

type ActionRecord = {
  occurrenceId: Hash; actionId: Hash; easUID: Hash; requestHash: Hash; recordHash: Hash;
  schemaUID: Hash; refUID: Hash; fan: Address; revision: number; actionCode: number;
  schemaVersion: number; policyVersion: number; status: number; origin: number; migrationBatchId: Hash;
};
type RecordedEvent = {
  actionId: Hash; fan: Address; campaignId: Hash; occurrenceId: Hash; revision: number;
  creatorId: Hash; actionName: string; schemaVersion: number; policyVersion: number; easUID: Hash; occurredDay: number; origin: number;
  migrationBatchId: Hash; transactionHash: Hash; blockNumber: bigint; blockHash: Hash;
};
type CredentialRef = {
  actionId: Hash; nftContract: Address; tokenId: bigint; kind: number; issuanceKey: Hash;
  linkOrigin: number; transactionHash: Hash; blockNumber: bigint; blockHash: Hash;
};
type InvalidatedEvent = { actionId: Hash; easUID: Hash; transactionHash: Hash; blockNumber: bigint; blockHash: Hash };
type CorrectedEvent = { previousActionId: Hash; newActionId: Hash; occurrenceId: Hash; transactionHash: Hash; blockNumber: bigint; blockHash: Hash };

export interface FinalizedActionSnapshot {
  blockNumber: bigint;
  blockHash: Hash;
  timestamp: bigint;
  actions: FinalizedIndexedFanAction[];
  lifecycleTransactions: ActionLifecycleTransaction[];
  deployments: Array<{ hubAddress: Address; fromBlock: bigint; label: string; actionCount: number }>;
  sourceCollisions: Hash[];
}

export interface FinalizedActionDeployment {
  hubAddress: Address;
  fromBlock: bigint;
  label?: string;
}

export interface FinalizedActionSnapshotOptions {
  rpcUrl: string;
  chainId: number;
  hubAddress: Address;
  fromBlock: bigint;
  environmentId: Hash;
  schemaUid: Hash;
  easAddress: Address;
  assets: Readonly<Record<number, Address>>;
  deployments?: readonly FinalizedActionDeployment[];
  client?: PublicClient;
}

const hubEventNames = ["FanActionRecorded", "CredentialLinked", "FanActionInvalidated", "FanActionCorrected"] as const;
const hubTopics = new Set(hubEventNames.map((eventName) => encodeEventTopics({ abi: actionHubAbi, eventName })[0]?.toLowerCase()));
const actionNames = new Map<number, string>(Object.entries(actionCodes).map(([name, code]) => [code, name]));

function sameHex(left: string, right: string): boolean { return left.toLowerCase() === right.toLowerCase(); }

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Action public snapshot deadline exceeded");
}

function canonicalActionId(occurrenceId: Hash, revision: number): Hash {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint32" }], [occurrenceId, revision]));
}

function credentialKey(chainId: number, nftContract: Address, tokenId: bigint): Hash {
  return keccak256(encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "uint256" }],
    [BigInt(chainId), getAddress(nftContract), tokenId],
  ));
}

async function loadHubLogs(client: PublicClient, address: Address, fromBlock: bigint, toBlock: bigint, signal: AbortSignal) {
  if (fromBlock > toBlock) throw new Error("Action public snapshot deployment block is after finalized head");
  if (toBlock - fromBlock + 1n > MAX_SCAN_BLOCKS) throw new Error("Action public snapshot block range cap exceeded");
  const logs: Awaited<ReturnType<PublicClient["getLogs"]>> = [];
  const ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  for (let start = fromBlock; start <= toBlock; start += LOG_CHUNK_BLOCKS) {
    const end = start + LOG_CHUNK_BLOCKS - 1n < toBlock ? start + LOG_CHUNK_BLOCKS - 1n : toBlock;
    ranges.push({ fromBlock: start, toBlock: end });
  }
  for (let index = 0; index < ranges.length; index += 4) {
    assertNotAborted(signal);
    const chunks = await Promise.all(ranges.slice(index, index + 4).map((range) => client.getLogs({ address, ...range })));
    for (const chunk of chunks) {
      if (logs.length + chunk.length > MAX_HUB_LOGS) throw new Error("Action public snapshot Hub log cap exceeded");
      logs.push(...chunk);
    }
  }
  logs.sort((left, right) => left.blockNumber === right.blockNumber
    ? Number((left.logIndex ?? 0) - (right.logIndex ?? 0))
    : left.blockNumber == null ? 1 : right.blockNumber == null ? -1 : left.blockNumber < right.blockNumber ? -1 : 1);
  return logs;
}

function decodeHubLogs(logs: Awaited<ReturnType<PublicClient["getLogs"]>>) {
  const recorded: RecordedEvent[] = [];
  const credentials: CredentialRef[] = [];
  const invalidated: InvalidatedEvent[] = [];
  const corrected: CorrectedEvent[] = [];
  for (const log of logs) {
    const topic = log.topics[0]?.toLowerCase();
    if (!topic || !hubTopics.has(topic)) continue;
    if (!log.transactionHash || !log.blockHash || log.blockNumber == null) {
      throw new Error("Action public snapshot known Hub event lacks canonical location");
    }
    let decoded: ReturnType<typeof decodeEventLog>;
    try {
      decoded = decodeEventLog({ abi: actionHubAbi, data: log.data, topics: log.topics });
    } catch (error) {
      throw new Error("Action public snapshot known Hub event decode failed", { cause: error });
    }
    const args = decoded.args as Record<string, unknown>;
    const location = { transactionHash: log.transactionHash, blockNumber: log.blockNumber, blockHash: log.blockHash };
    if (decoded.eventName === "FanActionRecorded") {
      recorded.push({
        actionId: args.actionId as Hash, fan: args.fan as Address, campaignId: args.campaignId as Hash,
        occurrenceId: args.occurrenceId as Hash, revision: Number(args.revision), creatorId: args.creatorId as Hash,
        actionName: String(args.actionName), schemaVersion: Number(args.schemaVersion), policyVersion: Number(args.policyVersion),
        easUID: args.easUID as Hash, occurredDay: Number(args.occurredDay),
        origin: Number(args.origin), migrationBatchId: args.migrationBatchId as Hash, ...location,
      });
    } else if (decoded.eventName === "CredentialLinked") {
      credentials.push({
        actionId: args.actionId as Hash, nftContract: args.nftContract as Address, tokenId: args.tokenId as bigint,
        kind: Number(args.credentialKind), issuanceKey: args.issuanceKey as Hash, linkOrigin: Number(args.linkOrigin), ...location,
      });
    } else if (decoded.eventName === "FanActionInvalidated") {
      invalidated.push({ actionId: args.actionId as Hash, easUID: args.easUID as Hash, ...location });
    } else if (decoded.eventName === "FanActionCorrected") {
      corrected.push({ previousActionId: args.previousActionId as Hash, newActionId: args.newActionId as Hash, occurrenceId: args.occurrenceId as Hash, ...location });
    }
  }
  if (recorded.length > MAX_ACTIONS) throw new Error("Action public snapshot action cap exceeded");
  return { recorded, credentials, invalidated, corrected };
}

function assertRecordMatchesEvent(record: ActionRecord, event: RecordedEvent) {
  if (event.revision < 1
    || !sameHex(event.actionId, canonicalActionId(event.occurrenceId, event.revision))
    || !sameHex(record.actionId, event.actionId)
    || !sameHex(record.occurrenceId, event.occurrenceId)
    || record.revision !== event.revision
    || getAddress(record.fan) !== getAddress(event.fan)
    || !sameHex(record.easUID, event.easUID)
    || record.schemaVersion !== event.schemaVersion
    || record.policyVersion !== event.policyVersion
    || actionNames.get(record.actionCode) !== event.actionName
    || record.origin !== event.origin
    || !sameHex(record.migrationBatchId, event.migrationBatchId)) {
    throw new Error("Action public snapshot Hub record mismatch");
  }
}

function refsHash(refs: readonly CredentialRef[]): Hash {
  const sorted = [...refs].sort((a, b) => {
    const addresses = BigInt(a.nftContract) < BigInt(b.nftContract) ? -1 : BigInt(a.nftContract) > BigInt(b.nftContract) ? 1 : 0;
    return addresses || (a.tokenId < b.tokenId ? -1 : a.tokenId > b.tokenId ? 1 : 0);
  });
  return keccak256(encodeAbiParameters([{ type: "tuple[]", components: [
    { name: "nftContract", type: "address" }, { name: "tokenId", type: "uint256" },
    { name: "kind", type: "uint8" }, { name: "issuanceKey", type: "bytes32" },
    { name: "linkOrigin", type: "uint8" },
  ] }], [sorted]));
}

function assertMintLog(ref: CredentialRef, recipient: Address, receipt: Awaited<ReturnType<PublicClient["getTransactionReceipt"]>>, expectedAsset: Address) {
  const matchingLogs = receipt.logs.filter((log) => getAddress(log.address) === getAddress(expectedAsset));
  const matches = matchingLogs.some((log) => {
    try {
      if (ref.kind === 0) {
        const decoded = decodeEventLog({ abi: erc721TransferAbi, data: log.data, topics: log.topics });
        const args = decoded.args;
        return getAddress(args.from) === ZERO_ADDRESS && getAddress(args.to) === getAddress(recipient) && args.tokenId === ref.tokenId;
      }
      const decoded = decodeEventLog({ abi: erc1155TransferAbi, data: log.data, topics: log.topics });
      const args = decoded.args as Record<string, unknown>;
      if (getAddress(args.from as Address) !== ZERO_ADDRESS || getAddress(args.to as Address) !== getAddress(recipient)) return false;
      if (decoded.eventName === "TransferSingle") return args.id === ref.tokenId && (args.value as bigint) > 0n;
      const ids = args.ids as readonly bigint[];
      const values = args.values as readonly bigint[];
      const index = ids.findIndex((id) => id === ref.tokenId);
      return ids.length === values.length && index >= 0 && (values[index] ?? 0n) > 0n;
    } catch {
      return false;
    }
  });
  if (!matches) throw new Error("Action public snapshot mint provenance mismatch");
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Map(values.map((value) => [value.toLowerCase(), value])).values()];
}

type DecodedRequest = {
  sourceOccurrence: Hash; revision: number; actionCode: number; schemaVersion: number;
  policyVersion: number; fan: Address; creatorId: Hash; campaignId: Hash;
  occurredDay: number; evidenceCommitment: Hash; migrationBatchId: Hash; bindingVersion: number;
};
type DecodedIntent = { kind: number; mode: number; issuanceKey: Hash; tokenId: bigint; metadataUri: string };

function canonicalOccurrenceId(chainId: number, hubAddress: Address, environmentId: Hash, sourceOccurrence: Hash): Hash {
  return keccak256(encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }],
    [BigInt(chainId), getAddress(hubAddress), environmentId, sourceOccurrence],
  ));
}

function decodeDirectRecordCall(input: Hash) {
  let decoded: ReturnType<typeof decodeFunctionData<typeof actionHubAbi>>;
  try {
    decoded = decodeFunctionData({ abi: actionHubAbi, data: input });
  } catch (error) {
    throw new Error("Action public snapshot transaction calldata decode failed", { cause: error });
  }
  if (decoded.functionName === "recordOnly") return { operation: 0, request: decoded.args[0] as DecodedRequest, intents: [] as DecodedIntent[], expectedPreviousActionId: undefined };
  if (decoded.functionName === "recordAndIssue") return { operation: 1, request: decoded.args[0] as DecodedRequest, intents: decoded.args[1] as readonly DecodedIntent[], expectedPreviousActionId: undefined };
  if (decoded.functionName === "importHistorical") return { operation: 2, request: decoded.args[0] as DecodedRequest, intents: decoded.args[1] as readonly DecodedIntent[], expectedPreviousActionId: undefined };
  if (decoded.functionName === "correct") return { operation: 3, request: decoded.args[1] as DecodedRequest, intents: decoded.args[2] as readonly DecodedIntent[], expectedPreviousActionId: decoded.args[0] as Hash };
  throw new Error("Action public snapshot transaction is not a direct record call");
}

function assertRequestMatchesRecord(request: DecodedRequest, record: ActionRecord, event: RecordedEvent, options: FinalizedActionSnapshotOptions) {
  if (!sameHex(canonicalOccurrenceId(options.chainId, options.hubAddress, options.environmentId, request.sourceOccurrence), record.occurrenceId)
    || request.revision !== record.revision || request.actionCode !== record.actionCode
    || request.schemaVersion !== record.schemaVersion || request.policyVersion !== record.policyVersion
    || getAddress(request.fan) !== getAddress(record.fan)
    || !sameHex(request.creatorId, event.creatorId) || !sameHex(request.campaignId, event.campaignId)
    || request.occurredDay !== event.occurredDay || !sameHex(request.migrationBatchId, record.migrationBatchId)) {
    throw new Error("Action public snapshot transaction source mismatch");
  }
}

async function verifyRecordedTransaction(
  client: PublicClient,
  options: FinalizedActionSnapshotOptions,
  event: RecordedEvent,
  record: ActionRecord,
  corrected: readonly CorrectedEvent[],
  blockNumber: bigint,
): Promise<Hash> {
  const transaction = await client.getTransaction({ hash: event.transactionHash });
  if (!sameHex(transaction.hash, event.transactionHash) || !transaction.blockHash || transaction.blockNumber == null
    || transaction.blockNumber !== event.blockNumber || !sameHex(transaction.blockHash, event.blockHash)
    || !transaction.to || getAddress(transaction.to) !== getAddress(options.hubAddress)) {
    throw new Error("Action public snapshot transaction location mismatch");
  }
  const decoded = decodeDirectRecordCall(transaction.input);
  assertRequestMatchesRecord(decoded.request, record, event, options);
  if ((record.origin === 1) !== (decoded.operation === 2) && decoded.operation !== 3) {
    throw new Error("Action public snapshot transaction origin mismatch");
  }
  if (decoded.operation === 3) {
    const correction = corrected.find((item) => sameHex(item.newActionId, record.actionId));
    if (!correction || !decoded.expectedPreviousActionId || !sameHex(decoded.expectedPreviousActionId, correction.previousActionId)) {
      throw new Error("Action public snapshot correction calldata mismatch");
    }
  }
  const requestHash = await client.readContract({
    address: options.hubAddress, abi: actionHubAbi, functionName: "hashRequest",
    args: [decoded.operation, decoded.request, decoded.intents], blockNumber,
  });
  if (!sameHex(requestHash, record.requestHash)) throw new Error("Action public snapshot transaction request hash mismatch");
  return decoded.request.sourceOccurrence;
}

async function verifyStandaloneInvalidation(client: PublicClient, hubAddress: Address, event: InvalidatedEvent): Promise<void> {
  const transaction = await client.getTransaction({ hash: event.transactionHash });
  if (!sameHex(transaction.hash, event.transactionHash) || transaction.blockNumber !== event.blockNumber
    || !transaction.blockHash || !sameHex(transaction.blockHash, event.blockHash)
    || !transaction.to || getAddress(transaction.to) !== getAddress(hubAddress)) {
    throw new Error("Action public snapshot invalidation transaction provenance mismatch");
  }
  let decoded: ReturnType<typeof decodeFunctionData<typeof actionHubAbi>>;
  try {
    decoded = decodeFunctionData({ abi: actionHubAbi, data: transaction.input });
  } catch (error) {
    throw new Error("Action public snapshot invalidation transaction calldata decode failed", { cause: error });
  }
  if (decoded.functionName !== "invalidate" || !sameHex(decoded.args[0], event.actionId)) {
    throw new Error("Action public snapshot invalidation transaction calldata mismatch");
  }
}

async function readFinalizedActionSnapshotInner(
  options: FinalizedActionSnapshotOptions,
  signal: AbortSignal,
  pinnedFinalized?: { number: bigint; hash: Hash; timestamp: bigint },
): Promise<FinalizedActionSnapshot> {
  const chain = defineChain({ id: options.chainId, name: "GIWA Sepolia", nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [options.rpcUrl] } } });
  const client = options.client ?? createPublicClient({ chain, transport: http(options.rpcUrl, { timeout: 15_000, retryCount: 0, fetchOptions: { signal } }) });
  assertNotAborted(signal);
  const finalized = pinnedFinalized ?? await client.getBlock({ blockTag: "finalized" });
  if (!finalized.hash) throw new Error("Action public snapshot finalized block has no hash");
  const blockNumber = finalized.number;
  const blockHash = finalized.hash;
  const timestamp = finalized.timestamp;

  const [actualChainId, actualEnvironment, actualEas, logs] = await Promise.all([
    client.getChainId(),
    client.readContract({ address: options.hubAddress, abi: actionHubAbi, functionName: "environmentId", blockNumber }),
    client.readContract({ address: options.hubAddress, abi: actionHubAbi, functionName: "eas", blockNumber }),
    loadHubLogs(client, options.hubAddress, options.fromBlock, blockNumber, signal),
  ]);
  if (actualChainId !== options.chainId
    || !sameHex(actualEnvironment, options.environmentId)
    || getAddress(actualEas) !== getAddress(options.easAddress)) {
    throw new Error("Action public snapshot chain/environment/EAS binding mismatch");
  }

  const events = decodeHubLogs(logs);
  const recordedById = new Map(events.recorded.map((event) => [event.actionId.toLowerCase(), event]));
  if (recordedById.size !== events.recorded.length) throw new Error("Action public snapshot duplicate record event");
  const refsByAction = new Map<string, CredentialRef[]>();
  for (const ref of events.credentials) {
    const expectedAsset = options.assets[ref.kind];
    if (!expectedAsset || getAddress(ref.nftContract) !== getAddress(expectedAsset)) throw new Error("Action public snapshot unknown credential asset");
    const refs = refsByAction.get(ref.actionId.toLowerCase()) ?? [];
    refs.push(ref);
    refsByAction.set(ref.actionId.toLowerCase(), refs);
  }
  for (const actionId of refsByAction.keys()) {
    if (!recordedById.has(actionId)) throw new Error("Action public snapshot credential event has no record event");
  }
  for (const ref of events.credentials) {
    const recordEvent = recordedById.get(ref.actionId.toLowerCase())!;
    if (!sameHex(ref.transactionHash, recordEvent.transactionHash)
      || ref.blockNumber !== recordEvent.blockNumber
      || !sameHex(ref.blockHash, recordEvent.blockHash)) {
      throw new Error("Action public snapshot credential location mismatch");
    }
  }

  const eventBlocks = new Map<string, Hash>();
  for (const event of [...events.recorded, ...events.credentials, ...events.invalidated, ...events.corrected]) {
    const key = event.blockNumber.toString();
    const prior = eventBlocks.get(key);
    if (prior && !sameHex(prior, event.blockHash)) throw new Error("Action public snapshot conflicting event block hashes");
    eventBlocks.set(key, event.blockHash);
  }
  if (eventBlocks.size > MAX_EVENT_BLOCKS) throw new Error("Action public snapshot event block cap exceeded");
  const canonicalEventBlocks = [...eventBlocks];
  for (let index = 0; index < canonicalEventBlocks.length; index += 16) {
    assertNotAborted(signal);
    await Promise.all(canonicalEventBlocks.slice(index, index + 16).map(async ([number, expectedHash]) => {
      const canonical = await client.getBlock({ blockNumber: BigInt(number) });
      if (!canonical.hash || !sameHex(canonical.hash, expectedHash)) throw new Error("Action public snapshot event block reorg");
    }));
  }

  const records = new Map<string, ActionRecord>();
  for (let index = 0; index < events.recorded.length; index += 16) {
    assertNotAborted(signal);
    await Promise.all(events.recorded.slice(index, index + 16).map(async (event) => {
      const [record, schema] = await Promise.all([
        client.readContract({ address: options.hubAddress, abi: actionHubAbi, functionName: "getAction", args: [event.actionId], blockNumber }) as Promise<ActionRecord>,
        client.readContract({ address: options.hubAddress, abi: actionHubAbi, functionName: "getSchema", args: [event.schemaVersion], blockNumber }),
      ]);
      assertRecordMatchesEvent(record, event);
      if (!sameHex(record.schemaUID, options.schemaUid) || !sameHex(schema, options.schemaUid)) throw new Error("Action public snapshot schema binding mismatch");
      records.set(event.actionId.toLowerCase(), record);
    }));
  }

  const latestByOccurrence = new Map<string, Hash>();
  const eventsByOccurrence = new Map<string, RecordedEvent[]>();
  for (const event of events.recorded) {
    const key = event.occurrenceId.toLowerCase();
    const occurrenceEvents = eventsByOccurrence.get(key) ?? [];
    occurrenceEvents.push(event);
    eventsByOccurrence.set(key, occurrenceEvents);
  }
  for (const [occurrenceKey, occurrenceEvents] of eventsByOccurrence) {
    assertNotAborted(signal);
    const occurrenceId = occurrenceEvents[0]!.occurrenceId;
    const latestActionId = await client.readContract({ address: options.hubAddress, abi: actionHubAbi, functionName: "latestActionId", args: [occurrenceId], blockNumber });
    const latestEvent = recordedById.get(latestActionId.toLowerCase());
    const maximumRevision = Math.max(...occurrenceEvents.map((event) => event.revision));
    if (!latestEvent || latestEvent.occurrenceId.toLowerCase() !== occurrenceKey || latestEvent.revision !== maximumRevision) {
      throw new Error("Action public snapshot latest action log incomplete");
    }
    latestByOccurrence.set(occurrenceKey, latestActionId);
  }

  for (const event of events.recorded) {
    const record = records.get(event.actionId.toLowerCase())!;
    if (record.revision === 1) {
      if (!sameHex(record.refUID, ZERO_HASH)) throw new Error("Action public snapshot correction chain mismatch");
      continue;
    }
    const previousId = canonicalActionId(record.occurrenceId, record.revision - 1);
    const previousEvent = recordedById.get(previousId.toLowerCase());
    const previous = records.get(previousId.toLowerCase());
    const correction = events.corrected.find((item) => sameHex(item.previousActionId, previousId) && sameHex(item.newActionId, record.actionId) && sameHex(item.occurrenceId, record.occurrenceId));
    const invalidation = events.invalidated.find((item) => sameHex(item.actionId, previousId) && sameHex(item.easUID, previous?.easUID ?? ZERO_HASH));
    if (!previousEvent || !previous || previous.status !== 3 || sameHex(previous.easUID, ZERO_HASH)
      || !sameHex(record.refUID, previous.easUID) || !correction || !invalidation
      || !sameHex(correction.transactionHash, event.transactionHash)
    ) {
      throw new Error("Action public snapshot correction chain mismatch");
    }
  }
  for (const correction of events.corrected) {
    const previous = records.get(correction.previousActionId.toLowerCase());
    const next = records.get(correction.newActionId.toLowerCase());
    if (!previous || !next || !sameHex(previous.occurrenceId, correction.occurrenceId)
      || !sameHex(next.occurrenceId, correction.occurrenceId) || next.revision !== previous.revision + 1) {
      throw new Error("Action public snapshot orphan correction event");
    }
  }
  for (const invalidation of events.invalidated) {
    const record = records.get(invalidation.actionId.toLowerCase());
    if (!record || !sameHex(record.easUID, invalidation.easUID) || record.status === 2) {
      throw new Error("Action public snapshot invalidation event mismatch");
    }
  }
  for (const record of records.values()) {
    if (![2, 3].includes(record.status)) throw new Error("Action public snapshot unsupported Hub record status");
    if (record.status === 3 && !events.invalidated.some((event) => sameHex(event.actionId, record.actionId) && sameHex(event.easUID, record.easUID))) {
      throw new Error("Action public snapshot invalidated record lacks lifecycle event");
    }
  }

  const recordedTransactions = new Set(events.recorded.map((event) => event.transactionHash.toLowerCase()));
  const standaloneInvalidations = events.invalidated
    .filter((event) => !recordedTransactions.has(event.transactionHash.toLowerCase()));
  for (let index = 0; index < standaloneInvalidations.length; index += 8) {
    assertNotAborted(signal);
    await Promise.all(standaloneInvalidations.slice(index, index + 8)
      .map((event) => verifyStandaloneInvalidation(client, options.hubAddress, event)));
  }

  const receiptCache = new Map<string, Awaited<ReturnType<PublicClient["getTransactionReceipt"]>>>();
  const actions: FinalizedIndexedFanAction[] = [];
  for (let index = 0; index < events.recorded.length; index += 8) {
    assertNotAborted(signal);
    const batch = await Promise.all(events.recorded.slice(index, index + 8).map(async (event): Promise<FinalizedIndexedFanAction> => {
    const record = records.get(event.actionId.toLowerCase())!;
    const refs = refsByAction.get(event.actionId.toLowerCase()) ?? [];
    const sourceOccurrence = await verifyRecordedTransaction(client, options, event, record, events.corrected, blockNumber);
    const [attestation, easValid] = await Promise.all([
      client.readContract({ address: options.easAddress, abi: easAbi, functionName: "getAttestation", args: [record.easUID], blockNumber }),
      client.readContract({ address: options.easAddress, abi: easAbi, functionName: "isAttestationValid", args: [record.easUID], blockNumber }),
    ]);
    const data = decodeAbiParameters([
      { type: "bytes32" }, { type: "bytes32" }, { type: "uint32" }, { type: "uint16" },
      { type: "uint16" }, { type: "uint32" }, { type: "bytes32" }, { type: "bytes32" },
      { type: "bytes32" }, { type: "uint32" }, { type: "uint8" }, { type: "bytes32" },
      { type: "bytes32" }, { type: "bytes32" },
    ], attestation.data);
    if (!sameHex(attestation.uid, record.easUID) || !sameHex(attestation.schema, options.schemaUid)
      || getAddress(attestation.recipient) !== getAddress(record.fan)
      || getAddress(attestation.attester) !== getAddress(options.hubAddress)
      || !sameHex(keccak256(attestation.data), record.recordHash)
      || !sameHex(data[0], record.occurrenceId) || !sameHex(data[1], record.actionId)
      || data[2] !== record.revision || data[3] !== record.actionCode || data[4] !== record.schemaVersion
      || data[5] !== record.policyVersion || event.policyVersion !== record.policyVersion || !sameHex(data[6], options.environmentId)
      || !sameHex(data[7], event.creatorId) || !sameHex(data[8], event.campaignId)
      || data[9] !== event.occurredDay || data[10] !== event.origin
      || !sameHex(data[12], refsHash(refs)) || !sameHex(data[13], record.migrationBatchId)
      || (record.revision === 1 ? !sameHex(attestation.refUID, ZERO_HASH) : !sameHex(attestation.refUID, record.refUID))) {
      throw new Error("Action public snapshot EAS record mismatch");
    }
    if (!easValid || (record.status === 2 && attestation.revocationTime !== 0n)
      || (record.status === 3 && attestation.revocationTime === 0n)) {
      throw new Error("Action public snapshot EAS lifecycle mismatch");
    }
    if (BigInt(event.occurredDay) > timestamp / 86_400n) throw new Error("Action public snapshot occurrence is after finalized timestamp");

    for (const ref of refs.filter((candidate) => candidate.linkOrigin === 0)) {
      let receipt = receiptCache.get(ref.transactionHash.toLowerCase());
      if (!receipt) {
        receipt = await client.getTransactionReceipt({ hash: ref.transactionHash });
        receiptCache.set(ref.transactionHash.toLowerCase(), receipt);
      }
      if (!sameHex(receipt.transactionHash, ref.transactionHash)
        || receipt.status !== "success" || receipt.blockNumber !== ref.blockNumber || !sameHex(receipt.blockHash, ref.blockHash)) {
        throw new Error("Action public snapshot mint receipt mismatch");
      }
      assertMintLog(ref, record.fan, receipt, options.assets[ref.kind]!);
    }

    let original = event;
    while (original.revision > 1) {
      const previous = recordedById.get(canonicalActionId(original.occurrenceId, original.revision - 1).toLowerCase());
      if (!previous) throw new Error("Action public snapshot original recipient unavailable");
      original = previous;
    }
    const credentials: IndexedCredential[] = refs.map((ref) => ({
      credentialKey: credentialKey(options.chainId, ref.nftContract, ref.tokenId), kind: ref.kind,
      linkOrigin: ref.linkOrigin, nftContract: getAddress(ref.nftContract), tokenId: ref.tokenId.toString(),
    }));
    const isLatest = sameHex(latestByOccurrence.get(record.occurrenceId.toLowerCase())!, record.actionId);
    return {
      chainId: options.chainId, sourceOccurrence, occurrenceId: record.occurrenceId, actionId: record.actionId,
      revision: record.revision, actionCode: record.actionCode, recipient: getAddress(record.fan),
      environmentId: options.environmentId, hubProxy: getAddress(options.hubAddress), schemaUid: record.schemaUID,
      easUid: record.easUID, easAttester: getAddress(attestation.attester), easRecipient: getAddress(attestation.recipient),
      easRevocationTime: attestation.revocationTime, easExpirationTime: attestation.expirationTime,
      easIsAttestationValid: easValid && isLatest, status: record.status === 2 ? "ACTIVE" : "INVALIDATED",
      origin: event.origin === 1 ? "HISTORICAL" : "NATIVE", finality: "finalized", txHash: event.transactionHash,
      creatorId: event.creatorId, campaignId: event.campaignId, occurredDay: event.occurredDay,
      blockNumber: event.blockNumber, blockHash: event.blockHash, originalRecipient: getAddress(original.fan), credentials,
    };
    }));
    actions.push(...batch);
  }

  const lifecycleByTx = new Map<string, { txHash: Hash; blockNumber: bigint; blockHash: Hash; kinds: Set<ActionLifecycleTransaction["kind"]>; actionIds: string[] }>();
  const appendLifecycle = (event: { transactionHash: Hash; blockNumber: bigint; blockHash: Hash }, kind: ActionLifecycleTransaction["kind"], actionIds: string[]) => {
    const key = event.transactionHash.toLowerCase();
    const item = lifecycleByTx.get(key) ?? { txHash: event.transactionHash, blockNumber: event.blockNumber, blockHash: event.blockHash, kinds: new Set(), actionIds: [] };
    if (item.blockNumber !== event.blockNumber || !sameHex(item.blockHash, event.blockHash)) throw new Error("Action public snapshot lifecycle transaction location mismatch");
    item.kinds.add(kind); item.actionIds.push(...actionIds); lifecycleByTx.set(key, item);
  };
  for (const event of events.recorded) appendLifecycle(event, "record", [event.actionId]);
  for (const event of events.invalidated) appendLifecycle(event, "invalidate", [event.actionId]);
  for (const event of events.corrected) appendLifecycle(event, "correct", [event.previousActionId, event.newActionId]);
  const lifecycleTransactions = [...lifecycleByTx.values()].map((item): ActionLifecycleTransaction => {
    const actionIds = uniqueStrings(item.actionIds);
    const relatedRecords = actionIds.map((id) => records.get(id.toLowerCase())).filter((record): record is ActionRecord => Boolean(record));
    if (relatedRecords.length === 0) throw new Error("Action public snapshot lifecycle transaction has no action record");
    const origins = new Set(relatedRecords.map((record) => record.origin));
    if (origins.size !== 1 || ![0, 1].includes(relatedRecords[0]!.origin)) throw new Error("Action public snapshot lifecycle origin mismatch");
    return {
      hubProxy: getAddress(options.hubAddress), txHash: item.txHash, blockNumber: item.blockNumber, blockHash: item.blockHash,
      kind: item.kinds.has("correct") ? "correct" : item.kinds.has("invalidate") ? "invalidate" : "record",
      actionIds, recipients: uniqueStrings(relatedRecords.map((record) => getAddress(record.fan))),
      origin: relatedRecords[0]!.origin === 1 ? "HISTORICAL" : "NATIVE",
    };
  });

  const finalCheck = await client.getBlock({ blockNumber });
  if (!finalCheck.hash || !sameHex(finalCheck.hash, blockHash)) throw new Error("Action public snapshot finalized block changed during read");
  return {
    blockNumber, blockHash, timestamp, actions, lifecycleTransactions,
    deployments: [{ hubAddress: getAddress(options.hubAddress), fromBlock: options.fromBlock, label: "ActionHub", actionCount: actions.length }],
    sourceCollisions: [],
  };
}

export async function readFinalizedActionSnapshot(options: FinalizedActionSnapshotOptions): Promise<FinalizedActionSnapshot> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error("Action public snapshot deadline exceeded");
      controller.abort(error);
      reject(error);
    }, SNAPSHOT_DEADLINE_MS);
  });
  try {
    const read = async () => {
      const deployments = options.deployments ?? [{ hubAddress: options.hubAddress, fromBlock: options.fromBlock, label: "ActionHub" }];
      if (deployments.length === 0) throw new Error("Action public snapshot requires at least one deployment");
      const uniqueHubs = new Set(deployments.map((deployment) => getAddress(deployment.hubAddress).toLowerCase()));
      if (uniqueHubs.size !== deployments.length) throw new Error("Action public snapshot duplicate Hub deployment");
      if (deployments.length === 1 && !options.deployments) return readFinalizedActionSnapshotInner(options, controller.signal);

      const chain = defineChain({ id: options.chainId, name: "GIWA Sepolia", nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [options.rpcUrl] } } });
      const client = options.client ?? createPublicClient({ chain, transport: http(options.rpcUrl, { timeout: 15_000, retryCount: 0, fetchOptions: { signal: controller.signal } }) });
      const finalized = await client.getBlock({ blockTag: "finalized" });
      if (!finalized.hash) throw new Error("Action public snapshot finalized block has no hash");
      const pinned = { number: finalized.number, hash: finalized.hash, timestamp: finalized.timestamp };
      const snapshots = await Promise.all(deployments.map(async (deployment) => {
        const { deployments: _ignoredDeployments, ...sharedOptions } = options;
        const snapshot = await readFinalizedActionSnapshotInner({
          ...sharedOptions, client, hubAddress: deployment.hubAddress, fromBlock: deployment.fromBlock,
        }, controller.signal, pinned);
        snapshot.deployments[0]!.label = deployment.label ?? "ActionHub";
        return snapshot;
      }));
      const actions = snapshots.flatMap((snapshot) => snapshot.actions);
      if (actions.length > MAX_ACTIONS) throw new Error("Action public snapshot combined action cap exceeded");
      const nativeSources = new Map<string, Set<string>>();
      for (const action of actions.filter((candidate) => candidate.origin === "NATIVE")) {
        const hubs = nativeSources.get(action.sourceOccurrence.toLowerCase()) ?? new Set<string>();
        hubs.add(getAddress(action.hubProxy).toLowerCase());
        nativeSources.set(action.sourceOccurrence.toLowerCase(), hubs);
      }
      const sourceCollisions = [...nativeSources.entries()].filter(([, hubs]) => hubs.size > 1).map(([source]) => source as Hash);
      const lifecycleByHash = new Map<string, ActionLifecycleTransaction>();
      for (const transaction of snapshots.flatMap((snapshot) => snapshot.lifecycleTransactions)) {
        const key = transaction.txHash.toLowerCase();
        const prior = lifecycleByHash.get(key);
        if (prior && (prior.blockNumber !== transaction.blockNumber || !sameHex(prior.blockHash, transaction.blockHash))) {
          throw new Error("Action public snapshot cross-Hub transaction location mismatch");
        }
        lifecycleByHash.set(key, prior ?? transaction);
      }
      const finalCheck = await client.getBlock({ blockNumber: pinned.number });
      if (!finalCheck.hash || !sameHex(finalCheck.hash, pinned.hash)) throw new Error("Action public snapshot common finalized block changed during read");
      return {
        blockNumber: pinned.number, blockHash: pinned.hash, timestamp: pinned.timestamp,
        actions, lifecycleTransactions: [...lifecycleByHash.values()],
        deployments: snapshots.flatMap((snapshot) => snapshot.deployments), sourceCollisions,
      };
    };
    return await Promise.race([read(), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
    if (!controller.signal.aborted) controller.abort();
  }
}
