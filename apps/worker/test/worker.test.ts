import { describe, expect, it, vi } from "vitest";
import type { BlockchainJob, JobPayload, PreparedSubmission } from "../src/domain.js";
import type { ChainPort, ClockPort, MetadataDocument, MetadataPort, MintReceipt, QueuePort } from "../src/ports.js";
import { MintWorker } from "../src/worker.js";

const txHash = `0x${"a".repeat(64)}`;
const signedTransaction = `0x${"12".repeat(100)}`;
const basePayload = {
  recipient: `0x${"1".repeat(40)}`,
  celebritySlug: "kara",
  passportId: `0x${"2".repeat(64)}`,
};

function job(payload: unknown = basePayload): BlockchainJob {
  return {
    id: "82479946-5c2b-4cb7-838a-cd48f260bbcf",
    entityType: "passport",
    entityId: "3ff058e6-8865-46c5-ae01-94a93f1dbe3c",
    operationKey: "passport:3ff058e6-8865-46c5-ae01-94a93f1dbe3c",
    payloadVersion: 1,
    payload,
    attempts: 1,
    maxAttempts: 8,
    txHash: null,
    leaseOwner: "worker-test",
    leaseExpiresAt: "2099-01-01T00:00:00.000Z",
  };
}

class FakeQueue implements QueuePort {
  jobs: BlockchainJob[];
  completed: Array<{ txHash: string; tokenId: bigint }> = [];
  retried: Array<{ code: string; retryable: boolean }> = [];
  prepared: PreparedSubmission[] = [];
  events: string[] = [];

  constructor(initial: BlockchainJob[]) { this.jobs = initial; }
  async claim(): Promise<BlockchainJob[]> { return this.jobs; }
  async recordPrepared(current: BlockchainJob, submission: PreparedSubmission): Promise<BlockchainJob> {
    this.events.push("record-prepared");
    this.prepared.push(submission);
    const updated = { ...current, txHash: submission.txHash, payload: { ...(current.payload as object), workerSubmission: submission } };
    this.jobs = [updated];
    return updated;
  }
  async complete(_job: BlockchainJob, hash: string, tokenId: bigint): Promise<void> {
    this.events.push("complete");
    this.completed.push({ txHash: hash, tokenId });
    this.jobs = [];
  }
  async retry(_job: BlockchainJob, code: string, _message: string, retryable: boolean): Promise<void> {
    this.events.push("retry");
    this.retried.push({ code, retryable });
  }
}

class FakeMetadata implements MetadataPort {
  documents: MetadataDocument[] = [];
  async pin(document: MetadataDocument): Promise<string> { this.documents.push(document); return "ipfs://bafy-metadata"; }
}

class FakeChain implements ChainPort {
  existing: MintReceipt | null = null;
  receiptResult: MintReceipt | null = { txHash, tokenId: 7n };
  prepareCount = 0;
  broadcastCount = 0;
  events: string[] = [];
  broadcastError: Error | null = null;
  preparedJobs: Array<{ entityType: string; payload: JobPayload; metadataUri: string }> = [];
  async findExisting(): Promise<MintReceipt | null> { return this.existing; }
  async prepare(entityType: "passport" | "stamp" | "reaction" | "collectible", payload: JobPayload, metadataUri: string): Promise<PreparedSubmission> {
    this.prepareCount += 1;
    this.events.push("prepare");
    this.preparedJobs.push({ entityType, payload, metadataUri });
    return { txHash, signedTransaction };
  }
  async broadcast(): Promise<string> {
    this.broadcastCount += 1;
    this.events.push("broadcast");
    if (this.broadcastError) throw this.broadcastError;
    return txHash;
  }
  async receipt(): Promise<MintReceipt | null> { return this.receiptResult; }
}

const clock: ClockPort = { sleep: vi.fn(async () => undefined) };
function worker(queue: QueuePort, metadata: MetadataPort, chain: ChainPort) {
  return new MintWorker(queue, metadata, chain, clock, {
    workerId: "worker-test", batchSize: 5, leaseSeconds: 120,
    receiptPollIntervalMs: 1, receiptPollAttempts: 2,
    assetBaseUri: "ipfs://bafy-assets/credentials/v1",
  });
}

describe("MintWorker", () => {
  it("pins metadata, persists the signed transaction before broadcast, and completes from receipt", async () => {
    const queue = new FakeQueue([job()]);
    const metadata = new FakeMetadata();
    const chain = new FakeChain();
    const allEvents: string[] = [];
    queue.events = allEvents;
    chain.events = allEvents;

    await expect(worker(queue, metadata, chain).runOnce()).resolves.toBe(1);

    expect(allEvents).toEqual(["prepare", "record-prepared", "broadcast", "complete"]);
    expect(queue.completed).toEqual([{ txHash, tokenId: 7n }]);
    expect(metadata.documents[0]).not.toHaveProperty("recipient");
    expect(JSON.stringify(metadata.documents[0])).not.toContain(basePayload.recipient);
  });

  it("classifies an RPC timeout as retryable", async () => {
    const queue = new FakeQueue([job()]);
    const chain = new FakeChain();
    chain.broadcastError = new Error("RPC timeout");
    await worker(queue, new FakeMetadata(), chain).runOnce();
    expect(queue.retried).toEqual([{ code: "UNEXPECTED_WORKER_ERROR", retryable: true }]);
    expect(queue.prepared).toHaveLength(1);
  });

  it("recovers a crash after submit with the same signed transaction and no second pin or prepare", async () => {
    const queue = new FakeQueue([job()]);
    const metadata = new FakeMetadata();
    const firstChain = new FakeChain();
    firstChain.broadcastError = new Error("process crashed after network accepted transaction");
    await worker(queue, metadata, firstChain).runOnce();
    expect(queue.jobs[0]?.payload).toHaveProperty("workerSubmission.signedTransaction", signedTransaction);

    const resumedChain = new FakeChain();
    await worker(queue, metadata, resumedChain).runOnce();

    expect(firstChain.prepareCount).toBe(1);
    expect(resumedChain.prepareCount).toBe(0);
    expect(resumedChain.broadcastCount).toBe(0);
    expect(metadata.documents).toHaveLength(1);
    expect(queue.completed).toEqual([{ txHash, tokenId: 7n }]);
  });

  it("falls back to canonical chain reconciliation when a prepared receipt is unavailable", async () => {
    const queue = new FakeQueue([job({ ...basePayload, workerSubmission: { txHash, signedTransaction } })]);
    const chain = new FakeChain();
    chain.receiptResult = null;
    chain.existing = { txHash, tokenId: 12n };

    await worker(queue, new FakeMetadata(), chain).runOnce();

    expect(queue.completed).toEqual([{ txHash, tokenId: 12n }]);
    expect(chain.prepareCount).toBe(0);
    expect(chain.broadcastCount).toBe(0);
  });

  it("reconciles an already minted credential without pinning or submitting a duplicate", async () => {
    const queue = new FakeQueue([job()]);
    const metadata = new FakeMetadata();
    const chain = new FakeChain();
    chain.existing = { txHash, tokenId: 44n };
    await worker(queue, metadata, chain).runOnce();
    expect(queue.completed).toEqual([{ txHash, tokenId: 44n }]);
    expect(metadata.documents).toHaveLength(0);
    expect(chain.prepareCount).toBe(0);
    expect(chain.broadcastCount).toBe(0);
  });

  it("decodes a first-reaction job through the full pre-broadcast pipeline", async () => {
    const reactionPayload = {
      recipient: `0x${"1".repeat(40)}`,
      celebritySlug: "kara",
      issuanceId: `0x${"3".repeat(64)}`,
      reactionType: "FirstReaction" as const,
    };
    const reactionJob: BlockchainJob = {
      ...job(reactionPayload),
      entityType: "reaction",
      operationKey: "reaction:first:3ff058e6-8865-46c5-ae01-94a93f1dbe3c",
    };
    const queue = new FakeQueue([reactionJob]);
    const metadata = new FakeMetadata();
    const chain = new FakeChain();

    await expect(worker(queue, metadata, chain).runOnce()).resolves.toBe(1);

    expect(chain.preparedJobs).toEqual([{
      entityType: "reaction",
      payload: reactionPayload,
      metadataUri: "ipfs://bafy-metadata",
    }]);
    expect(metadata.documents[0]).toMatchObject({
      name: "ByUs First Reaction",
      image: "ipfs://bafy-assets/credentials/v1/reaction/first/kara.png",
    });
    expect(queue.prepared).toHaveLength(1);
    expect(queue.completed).toEqual([{ txHash, tokenId: 7n }]);
  });

  it("decodes a Collectible job through its explicit pipeline", async () => {
    const collectiblePayload = {
      recipient: `0x${"1".repeat(40)}`,
      celebritySlug: "kara",
      liveSlug: "kara-september-live",
      claimId: "3ff058e6-8865-46c5-ae01-94a93f1dbe3c",
      metadataVersion: 1 as const,
    };
    const collectibleJob: BlockchainJob = {
      ...job(collectiblePayload), entityType: "collectible",
      operationKey: "byus:collectible:v1:3ff058e6-8865-46c5-ae01-94a93f1dbe3c",
    };
    const queue = new FakeQueue([collectibleJob]); const metadata = new FakeMetadata(); const chain = new FakeChain();
    await expect(worker(queue, metadata, chain).runOnce()).resolves.toBe(1);
    expect(chain.preparedJobs).toEqual([{ entityType: "collectible", payload: collectiblePayload, metadataUri: "ipfs://bafy-metadata" }]);
    expect(metadata.documents[0]).toMatchObject({ name: "ByUs Digital Collectible" });
  });

  it.each(["Attendance", "Survey"] as const)(
    "decodes a %s Stamp job through the full pre-broadcast pipeline",
    async (stampType) => {
      const stampPayload = {
        recipient: `0x${"1".repeat(40)}`,
        celebritySlug: "kara",
        issuanceId: `0x${"4".repeat(64)}`,
        stampType,
      };
      const stampJob: BlockchainJob = {
        ...job(stampPayload),
        entityType: "stamp",
        operationKey: `stamp:${stampType.toLowerCase()}:3ff058e6-8865-46c5-ae01-94a93f1dbe3c`,
      };
      const queue = new FakeQueue([stampJob]);
      const chain = new FakeChain();

      await expect(worker(queue, new FakeMetadata(), chain).runOnce()).resolves.toBe(1);

      expect(chain.preparedJobs).toEqual([{
        entityType: "stamp",
        payload: stampPayload,
        metadataUri: "ipfs://bafy-metadata",
      }]);
      expect(queue.prepared).toHaveLength(1);
      expect(queue.completed).toEqual([{ txHash, tokenId: 7n }]);
    },
  );

  it("does not resubmit when completion observes a stale lease", async () => {
    const queue = new FakeQueue([job({ ...basePayload, workerSubmission: { txHash, signedTransaction } })]);
    queue.complete = vi.fn(async () => { throw new Error("job lease is not active for this worker"); });
    queue.retry = vi.fn(async () => { throw new Error("job lease is not owned by this worker"); });
    const chain = new FakeChain();
    chain.existing = { txHash, tokenId: 9n };

    await expect(worker(queue, new FakeMetadata(), chain).runOnce()).rejects.toThrow("lease is not owned");
    expect(chain.prepareCount).toBe(0);
    expect(chain.broadcastCount).toBe(0);
  });

  it("rejects an unknown payload version permanently", async () => {
    const queue = new FakeQueue([{ ...job(), payloadVersion: 2 }]);
    await worker(queue, new FakeMetadata(), new FakeChain()).runOnce();
    expect(queue.retried).toEqual([{ code: "UNSUPPORTED_PAYLOAD_VERSION", retryable: false }]);
  });

  it("refuses to replace an unrecoverable transaction hash", async () => {
    const queue = new FakeQueue([{ ...job(), txHash }]);
    const chain = new FakeChain();
    await worker(queue, new FakeMetadata(), chain).runOnce();
    expect(chain.prepareCount).toBe(0);
    expect(chain.broadcastCount).toBe(0);
    expect(queue.retried).toEqual([{ code: "MISSING_SIGNED_TRANSACTION", retryable: true }]);
  });
});
