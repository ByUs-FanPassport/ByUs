import { buildCanonicalActionPayload, assertSnapshotMatchesCanonical } from "./action-builder.js";
import { parseActionSourceSnapshot, parseCanonicalActionPayload, type CanonicalActionPayloadV1, type FanActionJob } from "./action-domain.js";
import type { ActionChainPort, ActionMetadataPort, ActionQueuePort } from "./action-ports.js";
import { classifyError, type PreparedSubmission, WorkerError } from "./domain.js";
import type { ClockPort } from "./ports.js";

export interface ActionWorkerOptions {
  workerId: string;
  batchSize: number;
  leaseSeconds: number;
  receiptPollIntervalMs: number;
  receiptPollAttempts: number;
}

export class ActionWorker {
  constructor(
    private readonly queue: ActionQueuePort,
    private readonly metadata: ActionMetadataPort,
    private readonly chain: ActionChainPort,
    private readonly clock: ClockPort,
    private readonly options: ActionWorkerOptions,
  ) {}

  async runOnce(): Promise<number> {
    const jobs = await this.queue.claim(this.options.workerId, this.options.batchSize, this.options.leaseSeconds);
    for (const job of jobs) await this.processSafely(job);
    return jobs.length;
  }

  private async processSafely(initialJob: FanActionJob): Promise<void> {
    let job = initialJob;
    let writerHeld = false;
    let chainId: number | null = null;
    try {
      const snapshot = parseActionSourceSnapshot(job);
      chainId = snapshot.chainId;
      let payload = parseCanonicalActionPayload(job);
      if (payload) {
        assertSnapshotMatchesCanonical(snapshot, payload);
      } else {
        payload = await buildCanonicalActionPayload(job, snapshot, this.metadata, this.chain);
        job = await this.queue.prepareCanonical(job, payload);
        payload = parseCanonicalActionPayload(job);
        if (!payload) throw new WorkerError("ACTION_CANONICAL_PAYLOAD_NOT_STORED", "Database did not return the frozen canonical payload", true);
      }

      const submission = this.readSubmission(job, payload);
      if (submission) {
        const recovered = await this.chain.receipt(payload, submission);
        if (recovered) {
          await this.queue.complete(job, recovered);
          return;
        }
      }
      const existing = await this.chain.findExisting(payload);
      if (existing) {
        await this.queue.complete(job, existing);
        return;
      }

      if (!(await this.queue.admitDispatch(job))) return;

      writerHeld = await this.queue.admitWriter(job, payload.chainId, this.chain.relayerAddress, this.options.leaseSeconds);
      if (!writerHeld) return;

      let prepared = submission;
      if (!prepared) {
        if (job.txHash || job.signedTransaction) {
          throw new WorkerError("MISSING_ACTION_SIGNED_TRANSACTION", `Action job ${job.id} has partial transaction state`, true);
        }
        prepared = await this.chain.prepare(payload);
        job = await this.queue.recordPrepared(job, prepared);
      }
      const broadcastHash = await this.chain.broadcast(prepared.signedTransaction);
      if (broadcastHash.toLowerCase() !== prepared.txHash.toLowerCase()) {
        throw new WorkerError("TRANSACTION_HASH_MISMATCH", `Broadcast hash ${broadcastHash} did not match prepared hash ${prepared.txHash}`, false);
      }
      for (let attempt = 0; attempt < this.options.receiptPollAttempts; attempt += 1) {
        const receipt = await this.chain.receipt(payload, prepared);
        if (receipt) {
          await this.queue.complete(job, receipt);
          return;
        }
        if (attempt + 1 < this.options.receiptPollAttempts) await this.clock.sleep(this.options.receiptPollIntervalMs);
      }
      throw new WorkerError("ACTION_RECEIPT_PENDING", `Receipt was not available for ${prepared.txHash}`, true);
    } catch (error) {
      const classified = classifyError(error);
      await this.queue.retry(job, classified.code, classified.message, classified.retryable);
    } finally {
      if (writerHeld && chainId !== null) {
        await this.queue.releaseWriter(job, chainId, this.chain.relayerAddress);
      }
    }
  }

  private readSubmission(job: FanActionJob, payload: CanonicalActionPayloadV1): PreparedSubmission | null {
    const embedded = payload.workerSubmission;
    if (embedded && job.txHash && embedded.txHash.toLowerCase() !== job.txHash.toLowerCase()) {
      throw new WorkerError("ACTION_SIGNED_TRANSACTION_MISMATCH", "Payload transaction hash differs from the job transaction hash", false);
    }
    if (embedded) return embedded;
    if (!job.txHash && !job.signedTransaction) return null;
    if (!job.txHash || !job.signedTransaction) {
      throw new WorkerError("MISSING_ACTION_SIGNED_TRANSACTION", `Action job ${job.id} has incomplete transaction state`, true);
    }
    return { txHash: job.txHash, signedTransaction: job.signedTransaction };
  }
}
