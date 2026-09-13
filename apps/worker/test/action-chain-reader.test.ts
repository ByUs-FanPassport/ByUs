import { expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import { ViemActionLogReader } from "../src/action-chain-reader.js";
import { actionHubAbi } from "../src/adapters/viem-action-hub.js";

const hash = (byte: string) => `0x${byte.repeat(32)}` as Hash;
const zero = hash("00");
const environment = hash("11");
const hub = `0x${"22".repeat(20)}` as Address;
const eas = `0x${"33".repeat(20)}` as Address;
const fan = `0x${"44".repeat(20)}` as Address;
const occurrenceId = hash("55");
const creatorId = hash("66");
const campaignId = hash("77");
const migrationBatchId = hash("88");
const schemaUID = hash("99");
const blockHash = hash("ab");

type RecordFixture = {
  occurrenceId: Hash;
  actionId: Hash;
  easUID: Hash;
  requestHash: Hash;
  recordHash: Hash;
  schemaUID: Hash;
  refUID: Hash;
  fan: Address;
  revision: number;
  actionCode: number;
  schemaVersion: number;
  policyVersion: number;
  status: number;
  origin: number;
  migrationBatchId: Hash;
};

const canonicalActionId = (occurrence: Hash, revision: number) => keccak256(encodeAbiParameters(
  [{ type: "bytes32" }, { type: "uint32" }],
  [occurrence, revision],
));

const emptyRefsHash = keccak256(encodeAbiParameters([{ type: "tuple[]", components: [
  { name: "nftContract", type: "address" }, { name: "tokenId", type: "uint256" },
  { name: "kind", type: "uint8" }, { name: "issuanceKey", type: "bytes32" },
  { name: "linkOrigin", type: "uint8" },
] }], [[]]));

function actionData(record: Pick<RecordFixture, "occurrenceId" | "actionId" | "revision" | "actionCode" | "origin" | "migrationBatchId">) {
  return encodeAbiParameters([
    { type: "bytes32" }, { type: "bytes32" }, { type: "uint32" }, { type: "uint16" },
    { type: "uint16" }, { type: "uint32" }, { type: "bytes32" }, { type: "bytes32" },
    { type: "bytes32" }, { type: "uint32" }, { type: "uint8" }, { type: "bytes32" },
    { type: "bytes32" }, { type: "bytes32" },
  ], [record.occurrenceId, record.actionId, record.revision, record.actionCode, 1, 1, environment,
    creatorId, campaignId, 20_260_913, record.origin, hash("cd"), emptyRefsHash, record.migrationBatchId]);
}

function missingRecord(): RecordFixture {
  return {
    occurrenceId: zero, actionId: zero, easUID: zero, requestHash: zero, recordHash: zero,
    schemaUID: zero, refUID: zero, fan, revision: 0, actionCode: 0, schemaVersion: 0,
    policyVersion: 0, status: 0, origin: 0, migrationBatchId: zero,
  };
}

function fixture(options: {
  revision?: number;
  origin?: number;
  eventActionId?: Hash;
  current?: Partial<RecordFixture>;
  previous?: Partial<RecordFixture> | null;
  attestationRefUID?: Hash;
} = {}) {
  const revision = options.revision ?? 1;
  const origin = options.origin ?? 0;
  const expectedActionId = canonicalActionId(occurrenceId, revision);
  const eventActionId = options.eventActionId ?? expectedActionId;
  const previousActionId = revision > 1 ? canonicalActionId(occurrenceId, revision - 1) : zero;
  const previousEasUID = hash("ba");
  const defaultRefUID = revision === 1 ? zero : previousEasUID;
  const easUID = hash("ef");
  const baseCurrent: RecordFixture = {
    occurrenceId, actionId: expectedActionId, easUID, requestHash: hash("10"), recordHash: zero,
    schemaUID, refUID: defaultRefUID, fan, revision, actionCode: 7, schemaVersion: 1,
    policyVersion: 1, status: 2, origin, migrationBatchId,
  };
  const current = { ...baseCurrent, ...options.current };
  const data = actionData(current);
  current.recordHash = keccak256(data);
  const defaultPrevious: RecordFixture = {
    occurrenceId, actionId: previousActionId, easUID: previousEasUID, requestHash: hash("20"),
    recordHash: hash("21"), schemaUID, refUID: revision === 2 ? zero : hash("bc"), fan,
    revision: revision - 1, actionCode: 42, schemaVersion: 1, policyVersion: 1, status: 3,
    origin: 1, migrationBatchId: hash("22"),
  };
  const previous = options.previous === null ? missingRecord() : { ...defaultPrevious, ...options.previous };
  const records = new Map<string, RecordFixture>([
    [eventActionId.toLowerCase(), current],
    [previousActionId.toLowerCase(), previous],
  ]);
  const topics = encodeEventTopics({
    abi: actionHubAbi,
    eventName: "FanActionRecorded",
    args: { actionId: eventActionId, fan, campaignId },
  });
  const eventData = encodeAbiParameters([
    { type: "bytes32" }, { type: "uint32" }, { type: "bytes32" }, { type: "string" },
    { type: "uint16" }, { type: "uint32" }, { type: "bytes32" }, { type: "uint32" },
    { type: "uint8" }, { type: "bytes32" },
  ], [occurrenceId, revision, creatorId, "TEST_ACTION", 1, 1, easUID, 20_260_913, origin, migrationBatchId]);
  const readContract = vi.fn(async ({ address, functionName, args }: { address: Address; functionName: string; args?: readonly unknown[] }) => {
    if (address.toLowerCase() === hub.toLowerCase()) {
      if (functionName === "environmentId") return environment;
      if (functionName === "eas") return eas;
      if (functionName === "latestActionId") return eventActionId;
      if (functionName === "getAction") return records.get(String(args?.[0]).toLowerCase()) ?? missingRecord();
    }
    if (address.toLowerCase() === eas.toLowerCase()) {
      if (functionName === "isAttestationValid") return true;
      if (functionName === "getAttestation") return {
        uid: current.easUID, schema: current.schemaUID, time: 1n, expirationTime: 0n,
        revocationTime: current.status === 3 ? 1n : 0n,
        refUID: options.attestationRefUID ?? current.refUID, recipient: current.fan,
        attester: hub, revocable: true, data,
      };
    }
    throw new Error(`Unexpected readContract ${functionName}`);
  });
  const client = {
    getChainId: vi.fn().mockResolvedValue(91342),
    readContract,
    getLogs: vi.fn().mockResolvedValue([{
      address: hub, topics, data: eventData, transactionHash: hash("31"), blockHash,
      blockNumber: 100n, logIndex: 0, transactionIndex: 0,
    }]),
    getBlock: vi.fn(async ({ blockNumber, blockTag }: { blockNumber?: bigint; blockTag?: string }) =>
      blockNumber === 100n ? { hash: blockHash, number: 100n } : { hash: hash("32"), number: blockTag === "finalized" ? 99n : 100n }),
  };
  const reader = new ViemActionLogReader({ rpcUrl: "http://localhost:8545", chainId: 91342, hubAddress: hub, fromBlock: 100n, client: client as unknown as PublicClient });
  return { reader, client, readContract, previousActionId };
}

it.each(["chain", "environment"])("rejects mislabeled %s before loading actions", async (mismatch) => {
  const client = {
    getChainId: vi.fn().mockResolvedValue(mismatch === "chain" ? 1 : 91342),
    readContract: vi.fn().mockResolvedValue(mismatch === "environment" ? hash("33") : environment),
    getLogs: vi.fn(),
  };
  const reader = new ViemActionLogReader({ rpcUrl: "http://localhost:8545", chainId: 91342, hubAddress: hub, fromBlock: 0n, client: client as unknown as PublicClient });
  await expect(reader.read(environment)).rejects.toThrow("binding mismatch");
  expect(client.getLogs).not.toHaveBeenCalled();
});

it.each([0, 1])("accepts revision 1 with zero refs for origin %i", async (origin) => {
  const { reader } = fixture({ origin });
  const result = await reader.read(environment);
  expect(result).toHaveLength(1);
  expect(result[0]?.origin).toBe(origin === 1 ? "HISTORICAL" : "NATIVE");
});

it.each([
  ["Hub", { current: { refUID: hash("41") } }],
  ["EAS", { attestationRefUID: hash("42") }],
] as const)("rejects revision 1 with nonzero %s refUID", async (_label, options) => {
  await expect(fixture(options).reader.read(environment)).rejects.toThrow("correction chain mismatch");
});

it.each([2, 3])("accepts revision %i by reading the previous Hub record directly", async (revision) => {
  const { reader, readContract, previousActionId } = fixture({ revision });
  await expect(reader.read(environment)).resolves.toHaveLength(1);
  expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "getAction", args: [previousActionId] }));
});

it("accepts a correction when the previous event is outside fromBlock", async () => {
  const { reader, client } = fixture({ revision: 2 });
  await expect(reader.read(environment)).resolves.toHaveLength(1);
  expect(client.getLogs).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: 100n }));
  expect(await client.getLogs.mock.results[0]?.value).toHaveLength(1);
});

it.each([
  ["missing", null],
  ["wrong actionId", { actionId: hash("51") }],
  ["wrong occurrence", { occurrenceId: hash("52") }],
  ["wrong revision", { revision: 7 }],
  ["active status", { status: 2 }],
  ["zero EAS UID", { easUID: zero }],
] as const)("rejects a correction with %s previous record", async (_label, previous) => {
  await expect(fixture({ revision: 2, previous }).reader.read(environment)).rejects.toThrow("correction chain mismatch");
});

it.each([
  ["Hub", { current: { refUID: hash("61") } }],
  ["EAS", { attestationRefUID: hash("62") }],
] as const)("rejects a correction whose %s refUID differs from the previous EAS UID", async (_label, options) => {
  await expect(fixture({ revision: 2, ...options }).reader.read(environment)).rejects.toThrow("correction chain mismatch");
});

it.each([
  ["actionId", { actionId: hash("71") }],
  ["occurrenceId", { occurrenceId: hash("72") }],
  ["revision", { revision: 9 }],
] as const)("rejects a current Hub record whose %s differs from its event", async (_label, current) => {
  await expect(fixture({ current }).reader.read(environment)).rejects.toThrow("Hub record mismatch");
});

it("rejects an event with a noncanonical actionId", async () => {
  await expect(fixture({ eventActionId: hash("73") }).reader.read(environment)).rejects.toThrow("Hub record mismatch");
});
