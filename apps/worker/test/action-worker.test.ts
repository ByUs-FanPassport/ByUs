import { describe, expect, it, vi } from "vitest";
import { ActionWorker } from "../src/action-worker.js";
import { localActionId, localOccurrenceId, sourceOccurrenceId, type CanonicalActionPayloadV1, type FanActionJob } from "../src/action-domain.js";
import type { ActionChainPort, ActionQueuePort, ActionReceipt } from "../src/action-ports.js";
import type { PreparedSubmission } from "../src/domain.js";

const h = (v: string) => `0x${v.repeat(64)}`.slice(0, 66);
const address = (v: string) => `0x${v.repeat(40)}`.slice(0, 42);
const txHash = h("a"); const signedTransaction = `0x${"12".repeat(100)}`;
const source = { version: 1, chainId: 91342, environmentId: h("1"), hubProxy: address("2"), schemaUid: h("3"), schemaVersion: 1, bindingVersion: 1, operationKind: "RECORD_AND_ISSUE", sourceNamespace: "live_attendances", canonicalSourceKey: "source-1", revision: 1, actionCode: 3, policyVersion: 1, recipient: address("4"), creatorId: h("5"), campaignId: h("6"), sourceOccurredAt: "2026-09-12T10:00:00.000Z", origin: "NATIVE", evidenceCommitment: h("7"), migrationBatchId: h("0"), assetBaseUri: "ipfs://bafyassets/v1", credentials: [{ kind: 1, nftContract: address("8"), issuanceKey: h("9"), mode: "MINT", metadata: { operationKey: "attendance:1", legacyEntityType: "stamp", legacyPayload: { recipient: address("4"), celebritySlug: "kara", issuanceId: h("9"), stampType: "Attendance" } } }], migrationProof: [] } as const;
function makeJob(): FanActionJob { return { id: "82479946-5c2b-4cb7-838a-cd48f260bbcf", occurrenceRowId: "3ff058e6-8865-46c5-ae01-94a93f1dbe3c", payloadVersion: 1, sourceSnapshot: source, payload: null, actionId: null, requestHash: null, attempts: 1, maxAttempts: 8, txHash: null, signedTransaction: null, leaseOwner: "worker-test", leaseExpiresAt: "2099-01-01T00:00:00Z" }; }
const resultReceipt: ActionReceipt = { txHash, blockNumber: 10n, blockHash: h("b"), transactionIndex: 0, hubLogIndex: 1, easUid: h("c"), recordHash: h("d"), credentialRefsHash: h("e"), credentials: [], inclusionStatus: "included" };

class Queue implements ActionQueuePort {
  jobs = [makeJob()]; events: string[] = []; completed = 0; retried: string[] = []; admitted = true;
  async claim() { return this.jobs; }
  async admitDispatch() { this.events.push("admit-dispatch"); return this.admitted; }
  async admitWriter() { this.events.push("admit-writer"); return true; }
  async releaseWriter() { this.events.push("release-writer"); }
  async prepareCanonical(job: FanActionJob, payload: CanonicalActionPayloadV1) { this.events.push("freeze"); const next = { ...job, payload, actionId: payload.actionId, requestHash: payload.requestHash }; this.jobs = [next]; return next; }
  async recordPrepared(job: FanActionJob, submission: PreparedSubmission) { this.events.push("record-signed"); const next = { ...job, txHash: submission.txHash, signedTransaction: submission.signedTransaction }; this.jobs = [next]; return next; }
  async complete() { this.events.push("complete"); this.completed += 1; }
  async retry(_job: FanActionJob, code: string) { this.retried.push(code); }
}
class Chain implements ActionChainPort {
  relayerAddress = address("f"); events: string[] = []; existing: ActionReceipt | null = null; receiptResult: ActionReceipt | null = resultReceipt; prepareCalls = 0; broadcastCalls = 0;
  async canonicalHashes(payload: Parameters<ActionChainPort["canonicalHashes"]>[0]) { const occurrenceId = localOccurrenceId(payload.chainId, payload.hubProxy as `0x${string}`, payload.environmentId as `0x${string}`, payload.request.sourceOccurrence as `0x${string}`); return { occurrenceId, actionId: localActionId(occurrenceId, payload.request.revision), requestHash: h("d") }; }
  async findExisting() { return this.existing; }
  async prepare() { this.events.push("prepare"); this.prepareCalls += 1; return { txHash, signedTransaction }; }
  async broadcast() { this.events.push("broadcast"); this.broadcastCalls += 1; return txHash; }
  async receipt() { return this.receiptResult; }
}
const metadata = { pin: vi.fn(async () => "ipfs://attendance") };
const clock = { sleep: vi.fn(async () => undefined) };
function worker(queue: Queue, chain: Chain) { return new ActionWorker(queue, metadata, chain, clock, { workerId: "worker-test", batchSize: 5, leaseSeconds: 120, receiptPollIntervalMs: 1, receiptPollAttempts: 2 }); }

describe("ActionWorker", () => {
  it("freezes canonical payload and signed bytes before broadcast under the shared writer lease", async () => {
    const queue = new Queue(); const chain = new Chain(); const events: string[] = []; queue.events = events; chain.events = events;
    await expect(worker(queue, chain).runOnce()).resolves.toBe(1);
    expect(events).toEqual(["freeze", "admit-dispatch", "admit-writer", "prepare", "record-signed", "broadcast", "complete", "release-writer"]);
    expect(queue.completed).toBe(1);
  });
  it("recovers a stored signed transaction from receipt without repinning, resigning, or taking a writer lease", async () => {
    const queue = new Queue(); const chain = new Chain();
    const occurrenceId = localOccurrenceId(source.chainId, source.hubProxy as `0x${string}`, source.environmentId as `0x${string}`, sourceOccurrenceId(source.sourceNamespace, source.canonicalSourceKey));
    const payload = { version: 1, chainId: source.chainId, environmentId: source.environmentId, hubProxy: source.hubProxy, schemaUid: source.schemaUid, operation: 1, request: { sourceOccurrence: sourceOccurrenceId(source.sourceNamespace, source.canonicalSourceKey), revision: 1, actionCode: 3, schemaVersion: 1, policyVersion: 1, fan: source.recipient, creatorId: source.creatorId, campaignId: source.campaignId, occurredDay: Math.floor(Date.parse(source.sourceOccurredAt) / 86400000), evidenceCommitment: source.evidenceCommitment, migrationBatchId: source.migrationBatchId, bindingVersion: 1 }, occurrenceId, actionId: localActionId(occurrenceId, 1), intents: [{ kind: 1, mode: 0, nftContract: source.credentials[0].nftContract, issuanceKey: source.credentials[0].issuanceKey, tokenId: "0", metadataUri: "ipfs://attendance" }], migrationProof: [], requestHash: h("d") } satisfies CanonicalActionPayloadV1;
    queue.jobs = [{ ...makeJob(), payload, actionId: payload.actionId, requestHash: payload.requestHash, txHash, signedTransaction }];
    metadata.pin.mockClear(); await worker(queue, chain).runOnce();
    expect(queue.completed).toBe(1); expect(metadata.pin).not.toHaveBeenCalled(); expect(chain.prepareCalls).toBe(0); expect(chain.broadcastCalls).toBe(0); expect(queue.events).toEqual(["complete"]);
  });
  it("does not sign or broadcast when the daily action dispatch budget refuses admission", async () => {
    const queue = new Queue(); queue.admitted = false; const chain = new Chain(); chain.receiptResult = null;
    await worker(queue, chain).runOnce();
    expect(chain.prepareCalls).toBe(0); expect(chain.broadcastCalls).toBe(0); expect(queue.events).toEqual(["freeze", "admit-dispatch"]);
  });
});
