import { expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  getAddress,
  keccak256,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import { actionHubAbi, erc1155TransferAbi, erc721TransferAbi } from "../src/action-abi.js";
import { readFinalizedActionSnapshot } from "../src/action-public-snapshot.js";

const hash = (byte: string) => `0x${byte.repeat(32)}` as Hash;
const address = (byte: string) => `0x${byte.repeat(20)}` as Address;
const zeroHash = hash("00");
const zeroAddress = address("00");
const hub = address("11");
const eas = address("12");
const fan = address("13");
const passport = address("14");
const stamp = address("15");
const environmentId = hash("21");
const schemaUid = hash("22");
const sourceOccurrence = hash("23");
const occurrenceId = keccak256(encodeAbiParameters(
  [{ type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }],
  [91342n, hub, environmentId, sourceOccurrence],
));
const actionId = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint32" }], [occurrenceId, 1]));
const easUid = hash("24");
const creatorId = hash("25");
const campaignId = hash("26");
const migrationBatchId = zeroHash;
const txHash = hash("31");
const eventBlockHash = hash("32");
const finalBlockHash = hash("33");

type Ref = { nftContract: Address; tokenId: bigint; kind: number; issuanceKey: Hash; linkOrigin: number };

function refsHash(refs: readonly Ref[]) {
  return keccak256(encodeAbiParameters([{ type: "tuple[]", components: [
    { name: "nftContract", type: "address" }, { name: "tokenId", type: "uint256" },
    { name: "kind", type: "uint8" }, { name: "issuanceKey", type: "bytes32" },
    { name: "linkOrigin", type: "uint8" },
  ] }], [refs]));
}

function hubLog(eventName: "FanActionRecorded" | "CredentialLinked" | "FanActionInvalidated", args: Record<string, unknown>, transactionHash = txHash) {
  if (eventName === "FanActionRecorded") return {
    address: hub,
    topics: encodeEventTopics({ abi: actionHubAbi, eventName, args: { actionId, fan, campaignId } }),
    data: encodeAbiParameters([
      { type: "bytes32" }, { type: "uint32" }, { type: "bytes32" }, { type: "string" },
      { type: "uint16" }, { type: "uint32" }, { type: "bytes32" }, { type: "uint32" },
      { type: "uint8" }, { type: "bytes32" },
    ], [occurrenceId, 1, creatorId, "DAILY_CHECKIN", 1, 1, easUid, 1, 0, migrationBatchId]),
    transactionHash, blockNumber: 100n, blockHash: eventBlockHash, logIndex: 1, transactionIndex: 0,
  };
  if (eventName === "CredentialLinked") {
    const ref = args.ref as Ref;
    return {
      address: hub,
      topics: encodeEventTopics({ abi: actionHubAbi, eventName, args: { actionId, nftContract: ref.nftContract, tokenId: ref.tokenId } }),
      data: encodeAbiParameters([{ type: "uint8" }, { type: "bytes32" }, { type: "uint8" }], [ref.kind, ref.issuanceKey, ref.linkOrigin]),
      transactionHash, blockNumber: 100n, blockHash: eventBlockHash, logIndex: 0, transactionIndex: 0,
    };
  }
  return {
    address: hub,
    topics: encodeEventTopics({ abi: actionHubAbi, eventName, args: { actionId, easUID: easUid } }),
    data: encodeAbiParameters([{ type: "uint16" }], [Number(args.reasonCode ?? 1)]),
    transactionHash, blockNumber: 100n, blockHash: eventBlockHash, logIndex: 2, transactionIndex: 0,
  };
}

function makeFixture(options: {
  refs?: Ref[];
  invalidated?: boolean;
  includeInvalidation?: boolean;
  unknownInvalidation?: boolean;
  receiptLogs?: unknown[];
  easFailure?: boolean;
  changeFinalHash?: boolean;
  logs?: unknown[];
  latestActionId?: Hash;
  credentialTransactionHash?: Hash;
  receiptTransactionHash?: Hash;
} = {}) {
  const refs = options.refs ?? [];
  const data = encodeAbiParameters([
    { type: "bytes32" }, { type: "bytes32" }, { type: "uint32" }, { type: "uint16" },
    { type: "uint16" }, { type: "uint32" }, { type: "bytes32" }, { type: "bytes32" },
    { type: "bytes32" }, { type: "uint32" }, { type: "uint8" }, { type: "bytes32" },
    { type: "bytes32" }, { type: "bytes32" },
  ], [occurrenceId, actionId, 1, 10, 1, 1, environmentId, creatorId, campaignId, 1, 0, hash("41"), refsHash(refs), migrationBatchId]);
  const record = {
    occurrenceId, actionId, easUID: easUid, requestHash: hash("42"), recordHash: keccak256(data),
    schemaUID: schemaUid, refUID: zeroHash, fan, revision: 1, actionCode: 10, schemaVersion: 1,
    policyVersion: 1, status: options.invalidated ? 3 : 2, origin: 0, migrationBatchId,
  };
  const request = {
    sourceOccurrence, revision: 1, actionCode: 10, schemaVersion: 1, policyVersion: 1,
    fan, creatorId, campaignId, occurredDay: 1, evidenceCommitment: hash("41"),
    migrationBatchId, bindingVersion: 1,
  } as const;
  const intents = refs.map((ref) => ({
    kind: ref.kind, mode: ref.linkOrigin === 0 ? 0 : 1, issuanceKey: ref.issuanceKey,
    tokenId: ref.tokenId, metadataUri: "",
  }));
  const defaultLogs = [
    ...refs.map((ref) => hubLog("CredentialLinked", { ref }, options.credentialTransactionHash)),
    hubLog("FanActionRecorded", {}),
    ...(options.includeInvalidation ? [options.unknownInvalidation
      ? { ...hubLog("FanActionInvalidated", {}), topics: encodeEventTopics({ abi: actionHubAbi, eventName: "FanActionInvalidated", args: { actionId: hash("ff"), easUID: hash("fe") } }) }
      : hubLog("FanActionInvalidated", {})] : []),
  ];
  let finalBlockReads = 0;
  const readContract = vi.fn(async ({ address: target, functionName, blockNumber }: { address: Address; functionName: string; blockNumber?: bigint }) => {
    expect(blockNumber).toBe(120n);
    if (getAddress(target) === getAddress(hub)) {
      if (functionName === "environmentId") return environmentId;
      if (functionName === "eas") return eas;
      if (functionName === "getSchema") return schemaUid;
      if (functionName === "getAction") return record;
      if (functionName === "latestActionId") return options.latestActionId ?? actionId;
      if (functionName === "hashRequest") return record.requestHash;
    }
    if (getAddress(target) === getAddress(eas)) {
      if (options.easFailure) throw new Error("EAS RPC unavailable");
      if (functionName === "isAttestationValid") return true;
      if (functionName === "getAttestation") return {
        uid: easUid, schema: schemaUid, time: 1n, expirationTime: 0n,
        revocationTime: options.invalidated ? 2n : 0n, refUID: zeroHash,
        recipient: fan, attester: hub, revocable: true, data,
      };
    }
    throw new Error(`Unexpected ${functionName}`);
  });
  const client = {
    getChainId: vi.fn().mockResolvedValue(91342),
    readContract,
    getLogs: vi.fn().mockResolvedValue(options.logs ?? defaultLogs),
    getBlock: vi.fn(async ({ blockTag, blockNumber }: { blockTag?: string; blockNumber?: bigint }) => {
      if (blockTag === "finalized") return { number: 120n, hash: finalBlockHash, timestamp: 200_000n };
      if (blockNumber === 100n) return { number: 100n, hash: eventBlockHash, timestamp: 100_000n };
      if (blockNumber === 120n) {
        finalBlockReads += 1;
        return { number: 120n, hash: options.changeFinalHash && finalBlockReads > 0 ? hash("99") : finalBlockHash, timestamp: 200_000n };
      }
      throw new Error("Unexpected block");
    }),
    getTransactionReceipt: vi.fn().mockResolvedValue({
      transactionHash: options.receiptTransactionHash ?? txHash, blockNumber: 100n, blockHash: eventBlockHash, status: "success", logs: options.receiptLogs ?? [],
    }),
    getTransaction: vi.fn(async ({ hash: requestedHash }: { hash: Hash }) => ({
      hash: requestedHash,
      blockNumber: 100n, blockHash: eventBlockHash, to: hub,
      input: encodeFunctionData({ abi: actionHubAbi, functionName: "recordAndIssue", args: [request, intents] }),
    })),
  };
  return { client, options: {
    rpcUrl: "http://localhost:8545", chainId: 91342, hubAddress: hub, fromBlock: 1n,
    environmentId, schemaUid, easAddress: eas, assets: { 0: passport, 1: stamp }, client: client as unknown as PublicClient,
  } };
}

it("returns a finalized, pinned snapshot and deduplicates lifecycle events by transaction", async () => {
  const fixture = makeFixture({ invalidated: true, includeInvalidation: true });
  const result = await readFinalizedActionSnapshot(fixture.options);
  expect(result).toMatchObject({ blockNumber: 120n, blockHash: finalBlockHash, timestamp: 200_000n });
  expect(result.actions[0]).toMatchObject({ sourceOccurrence, easUid, creatorId, campaignId, occurredDay: 1, originalRecipient: getAddress(fan), finality: "finalized" });
  expect(result.lifecycleTransactions).toEqual([expect.objectContaining({ kind: "invalidate", actionIds: [actionId], recipients: [getAddress(fan)] })]);
  expect(fixture.client.getLogs).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: 1n, toBlock: 120n }));
});

it("classifies a correction transaction once and rejects an older reported latest revision", async () => {
  const nextActionId = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint32" }], [occurrenceId, 2]));
  const nextEasUid = hash("27");
  const nextFan = address("16");
  const correctionTx = hash("34");
  const firstLog = hubLog("FanActionRecorded", {});
  const nextRecorded = {
    address: hub,
    topics: encodeEventTopics({ abi: actionHubAbi, eventName: "FanActionRecorded", args: { actionId: nextActionId, fan: nextFan, campaignId } }),
    data: encodeAbiParameters([
      { type: "bytes32" }, { type: "uint32" }, { type: "bytes32" }, { type: "string" },
      { type: "uint16" }, { type: "uint32" }, { type: "bytes32" }, { type: "uint32" },
      { type: "uint8" }, { type: "bytes32" },
    ], [occurrenceId, 2, creatorId, "DAILY_CHECKIN", 1, 1, nextEasUid, 1, 0, migrationBatchId]),
    transactionHash: correctionTx, blockNumber: 100n, blockHash: eventBlockHash, logIndex: 4, transactionIndex: 1,
  };
  const correction = {
    address: hub,
    topics: encodeEventTopics({ abi: actionHubAbi, eventName: "FanActionCorrected", args: { previousActionId: actionId, newActionId: nextActionId, occurrenceId } }),
    data: "0x", transactionHash: correctionTx, blockNumber: 100n, blockHash: eventBlockHash, logIndex: 5, transactionIndex: 1,
  };
  const correctionInvalidation = hubLog("FanActionInvalidated", {}, correctionTx);
  const easData = (id: Hash, uid: Hash, revision: number, recipient: Address, refUID: Hash) => {
    const encoded = encodeAbiParameters([
      { type: "bytes32" }, { type: "bytes32" }, { type: "uint32" }, { type: "uint16" },
      { type: "uint16" }, { type: "uint32" }, { type: "bytes32" }, { type: "bytes32" },
      { type: "bytes32" }, { type: "uint32" }, { type: "uint8" }, { type: "bytes32" },
      { type: "bytes32" }, { type: "bytes32" },
    ], [occurrenceId, id, revision, 10, 1, 1, environmentId, creatorId, campaignId, 1, 0, hash("41"), refsHash([]), migrationBatchId]);
    return { encoded, attestation: { uid, schema: schemaUid, time: 1n, expirationTime: 0n, revocationTime: revision === 1 ? 2n : 0n, refUID, recipient, attester: hub, revocable: true, data: encoded } };
  };
  const first = easData(actionId, easUid, 1, fan, zeroHash);
  const next = easData(nextActionId, nextEasUid, 2, nextFan, easUid);
  const records = new Map([
    [actionId.toLowerCase(), { occurrenceId, actionId, easUID: easUid, requestHash: hash("42"), recordHash: keccak256(first.encoded), schemaUID: schemaUid, refUID: zeroHash, fan, revision: 1, actionCode: 10, schemaVersion: 1, policyVersion: 1, status: 3, origin: 0, migrationBatchId }],
    [nextActionId.toLowerCase(), { occurrenceId, actionId: nextActionId, easUID: nextEasUid, requestHash: hash("43"), recordHash: keccak256(next.encoded), schemaUID: schemaUid, refUID: easUid, fan: nextFan, revision: 2, actionCode: 10, schemaVersion: 1, policyVersion: 1, status: 2, origin: 0, migrationBatchId }],
  ]);
  let reportedLatestActionId = nextActionId;
  const base = makeFixture({ logs: [firstLog, correctionInvalidation, nextRecorded, correction] });
  base.client.readContract.mockImplementation(async ({ address: target, functionName, args, blockNumber }: { address: Address; functionName: string; args?: readonly unknown[]; blockNumber?: bigint }) => {
    expect(blockNumber).toBe(120n);
    if (getAddress(target) === getAddress(hub)) {
      if (functionName === "environmentId") return environmentId;
      if (functionName === "eas") return eas;
      if (functionName === "getSchema") return schemaUid;
      if (functionName === "getAction") return records.get(String(args?.[0]).toLowerCase())!;
      if (functionName === "latestActionId") return reportedLatestActionId;
      if (functionName === "hashRequest") return Number((args?.[1] as { revision: number }).revision) === 1 ? hash("42") : hash("43");
    }
    if (getAddress(target) === getAddress(eas)) {
      const item = sameUid(args?.[0], easUid) ? first.attestation : next.attestation;
      return functionName === "getAttestation" ? item : true;
    }
    throw new Error(`Unexpected ${functionName}`);
  });
  base.client.getTransaction.mockImplementation(async ({ hash: requestedHash }: { hash: Hash }) => ({
    hash: requestedHash,
    blockNumber: 100n, blockHash: eventBlockHash, to: hub,
    input: requestedHash === correctionTx
      ? encodeFunctionData({
          abi: actionHubAbi, functionName: "correct", args: [actionId, {
            sourceOccurrence, revision: 2, actionCode: 10, schemaVersion: 1, policyVersion: 1,
            fan: nextFan, creatorId, campaignId, occurredDay: 1, evidenceCommitment: hash("41"),
            migrationBatchId, bindingVersion: 1,
          }, []],
        })
      : encodeFunctionData({
          abi: actionHubAbi, functionName: "recordAndIssue", args: [{
            sourceOccurrence, revision: 1, actionCode: 10, schemaVersion: 1, policyVersion: 1,
            fan, creatorId, campaignId, occurredDay: 1, evidenceCommitment: hash("41"),
            migrationBatchId, bindingVersion: 1,
          }, []],
        }),
  }));
  const result = await readFinalizedActionSnapshot(base.options);
  expect(result.lifecycleTransactions).toHaveLength(2);
  expect(result.lifecycleTransactions.find((item) => item.txHash === correctionTx)).toMatchObject({
    kind: "correct", actionIds: [nextActionId, actionId], recipients: [getAddress(nextFan), getAddress(fan)],
  });
  expect(result.actions[1]?.originalRecipient).toBe(getAddress(fan));
  reportedLatestActionId = actionId;
  await expect(readFinalizedActionSnapshot(base.options)).rejects.toThrow("latest action log incomplete");
});

it("fails closed when the finalized block hash changes during the read", async () => {
  await expect(readFinalizedActionSnapshot(makeFixture({ changeFinalHash: true }).options)).rejects.toThrow("finalized block changed");
});

it("rejects a latest action id that is absent from the complete record log set", async () => {
  await expect(readFinalizedActionSnapshot(makeFixture({ latestActionId: hash("fa") }).options)).rejects.toThrow("latest action log incomplete");
});

it("rejects a recorded event whose canonical transaction did not call the allowlisted Hub directly", async () => {
  const fixture = makeFixture();
  fixture.client.getTransaction.mockResolvedValue({
    hash: txHash, blockNumber: 100n, blockHash: eventBlockHash, to: address("77"), input: "0x",
  });
  await expect(readFinalizedActionSnapshot(fixture.options)).rejects.toThrow("transaction location mismatch");
});

it("rejects a latest action event belonging to a different occurrence", async () => {
  const otherOccurrenceId = hash("61");
  const otherActionId = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint32" }], [otherOccurrenceId, 1]));
  const otherEasUid = hash("62");
  const otherFan = address("63");
  const otherLog = {
    address: hub,
    topics: encodeEventTopics({ abi: actionHubAbi, eventName: "FanActionRecorded", args: { actionId: otherActionId, fan: otherFan, campaignId } }),
    data: encodeAbiParameters([
      { type: "bytes32" }, { type: "uint32" }, { type: "bytes32" }, { type: "string" },
      { type: "uint16" }, { type: "uint32" }, { type: "bytes32" }, { type: "uint32" },
      { type: "uint8" }, { type: "bytes32" },
    ], [otherOccurrenceId, 1, creatorId, "DAILY_CHECKIN", 1, 1, otherEasUid, 1, 0, migrationBatchId]),
    transactionHash: hash("64"), blockNumber: 100n, blockHash: eventBlockHash, logIndex: 3, transactionIndex: 1,
  };
  const base = makeFixture({ logs: [hubLog("FanActionRecorded", {}), otherLog] });
  const originalImplementation = base.client.readContract.getMockImplementation()!;
  const otherRecord = {
    occurrenceId: otherOccurrenceId, actionId: otherActionId, easUID: otherEasUid,
    requestHash: hash("65"), recordHash: hash("66"), schemaUID: schemaUid, refUID: zeroHash,
    fan: otherFan, revision: 1, actionCode: 10, schemaVersion: 1, policyVersion: 1,
    status: 2, origin: 0, migrationBatchId,
  };
  base.client.readContract.mockImplementation(async (request) => {
    const args = (request as typeof request & { args?: readonly unknown[] }).args;
    if (request.functionName === "getAction" && sameUid(args?.[0], otherActionId)) return otherRecord;
    if (request.functionName === "latestActionId") return otherActionId;
    return originalImplementation(request);
  });
  await expect(readFinalizedActionSnapshot(base.options)).rejects.toThrow("latest action log incomplete");
});

it("propagates an EAS RPC failure instead of converting it to false", async () => {
  await expect(readFinalizedActionSnapshot(makeFixture({ easFailure: true }).options)).rejects.toThrow("EAS RPC unavailable");
});

it("aborts the whole snapshot after its 45 second deadline", async () => {
  vi.useFakeTimers();
  try {
    const client = { getBlock: vi.fn(() => new Promise(() => undefined)) };
    const pending = readFinalizedActionSnapshot({
      rpcUrl: "http://localhost:8545", chainId: 91342, hubAddress: hub, fromBlock: 1n,
      environmentId, schemaUid, easAddress: eas, assets: { 0: passport, 1: stamp },
      client: client as unknown as PublicClient,
    });
    const assertion = expect(pending).rejects.toThrow("deadline exceeded");
    await vi.advanceTimersByTimeAsync(45_000);
    await assertion;
  } finally {
    vi.useRealTimers();
  }
});

it("rejects a standalone invalidation for an unknown action", async () => {
  await expect(readFinalizedActionSnapshot(makeFixture({ includeInvalidation: true, unknownInvalidation: true }).options)).rejects.toThrow("invalidation event mismatch");
});

it("fails closed when the action resource cap is exceeded", async () => {
  const repeated = Array.from({ length: 10_001 }, () => hubLog("FanActionRecorded", {}));
  await expect(readFinalizedActionSnapshot(makeFixture({ logs: repeated }).options)).rejects.toThrow("action cap exceeded");
});

it("rejects a claimed ERC-721 mint without a matching zero-sender Transfer", async () => {
  const ref = { nftContract: passport, tokenId: 7n, kind: 0, issuanceKey: hash("51"), linkOrigin: 0 };
  const transfer = {
    address: passport,
    topics: encodeEventTopics({ abi: erc721TransferAbi, eventName: "Transfer", args: { from: fan, to: fan, tokenId: 7n } }),
    data: "0x", blockNumber: 100n, blockHash: eventBlockHash, transactionHash: txHash, logIndex: 0, transactionIndex: 0,
  };
  await expect(readFinalizedActionSnapshot(makeFixture({ refs: [ref], receiptLogs: [transfer] }).options)).rejects.toThrow("mint provenance mismatch");
});

it("rejects a credential event emitted in a different transaction than its action record", async () => {
  const ref = { nftContract: passport, tokenId: 7n, kind: 0, issuanceKey: hash("51"), linkOrigin: 0 };
  await expect(readFinalizedActionSnapshot(makeFixture({ refs: [ref], credentialTransactionHash: hash("ee") }).options)).rejects.toThrow("credential location mismatch");
});

it("rejects mint provenance returned under a different receipt transaction hash", async () => {
  const ref = { nftContract: passport, tokenId: 7n, kind: 0, issuanceKey: hash("51"), linkOrigin: 0 };
  await expect(readFinalizedActionSnapshot(makeFixture({ refs: [ref], receiptTransactionHash: hash("ed") }).options)).rejects.toThrow("mint receipt mismatch");
});

it("rejects credential events from an asset outside the fixed kind binding", async () => {
  const ref = { nftContract: address("77"), tokenId: 7n, kind: 0, issuanceKey: hash("51"), linkOrigin: 1 };
  await expect(readFinalizedActionSnapshot(makeFixture({ refs: [ref] }).options)).rejects.toThrow("unknown credential asset");
});

it("rejects a zero-quantity ERC-1155 mint", async () => {
  const ref = { nftContract: stamp, tokenId: 8n, kind: 1, issuanceKey: hash("52"), linkOrigin: 0 };
  const transfer = {
    address: stamp,
    topics: encodeEventTopics({ abi: erc1155TransferAbi, eventName: "TransferSingle", args: { operator: hub, from: zeroAddress, to: fan } }),
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [8n, 0n]),
    blockNumber: 100n, blockHash: eventBlockHash, transactionHash: txHash, logIndex: 0, transactionIndex: 0,
  };
  await expect(readFinalizedActionSnapshot(makeFixture({ refs: [ref], receiptLogs: [transfer] }).options)).rejects.toThrow("mint provenance mismatch");
});

it("reads every allowlisted Hub at one common finalized block and keeps an empty new deployment available", async () => {
  const newHub = address("17");
  const getBlock = vi.fn(async ({ blockTag, blockNumber }: { blockTag?: string; blockNumber?: bigint }) => {
    if (blockTag === "finalized" || blockNumber === 120n) return { number: 120n, hash: finalBlockHash, timestamp: 200_000n };
    throw new Error("Unexpected block");
  });
  const client = {
    getChainId: vi.fn().mockResolvedValue(91342), getBlock,
    getLogs: vi.fn().mockResolvedValue([]),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "environmentId") return environmentId;
      if (functionName === "eas") return eas;
      throw new Error(`Unexpected ${functionName}`);
    }),
  };
  const result = await readFinalizedActionSnapshot({
    rpcUrl: "http://localhost:8545", chainId: 91342, hubAddress: newHub, fromBlock: 1n,
    deployments: [
      { label: "Legacy ActionHub", hubAddress: hub, fromBlock: 1n },
      { label: "New ActionHub", hubAddress: newHub, fromBlock: 110n },
    ],
    environmentId, schemaUid, easAddress: eas, assets: { 0: passport, 1: stamp }, client: client as unknown as PublicClient,
  });
  expect(getBlock.mock.calls.filter(([request]) => request.blockTag === "finalized")).toHaveLength(1);
  expect(client.getLogs).toHaveBeenCalledTimes(2);
  expect(client.getLogs).toHaveBeenCalledWith(expect.objectContaining({ address: hub, fromBlock: 1n, toBlock: 120n }));
  expect(result.deployments).toEqual([
    expect.objectContaining({ label: "Legacy ActionHub", actionCount: 0 }),
    expect.objectContaining({ label: "New ActionHub", actionCount: 0 }),
  ]);
});

it("fails the whole multi-Hub snapshot when one source cannot be read", async () => {
  const newHub = address("17");
  const client = {
    getChainId: vi.fn().mockResolvedValue(91342),
    getBlock: vi.fn().mockResolvedValue({ number: 120n, hash: finalBlockHash, timestamp: 200_000n }),
    getLogs: vi.fn(async ({ address: target }: { address: Address }) => {
      if (getAddress(target) === getAddress(newHub)) throw new Error("new Hub RPC unavailable");
      return [];
    }),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => functionName === "environmentId" ? environmentId : eas),
  };
  await expect(readFinalizedActionSnapshot({
    rpcUrl: "http://localhost:8545", chainId: 91342, hubAddress: newHub, fromBlock: 1n,
    deployments: [{ hubAddress: hub, fromBlock: 1n }, { hubAddress: newHub, fromBlock: 110n }],
    environmentId, schemaUid, easAddress: eas, assets: { 0: passport, 1: stamp }, client: client as unknown as PublicClient,
  })).rejects.toThrow("new Hub RPC unavailable");
});

function sameUid(value: unknown, expected: Hash): boolean {
  return String(value).toLowerCase() === expected.toLowerCase();
}
