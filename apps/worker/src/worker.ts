import { classifyError, parseJobPayload, WorkerError, type BlockchainJob } from "./domain.js";
import { renderMetadata } from "./metadata.js";
import type { ChainPort, ClockPort, MetadataPort, QueuePort } from "./ports.js";

export interface WorkerOptions {
  workerId: string;
  batchSize: number;
  leaseSeconds: number;
  receiptPollIntervalMs: number;
  receiptPollAttempts: number;
  assetBaseUri: string;
}

export class MintWorker {
  constructor(
    private readonly queue: QueuePort,
    private readonly metadata: MetadataPort,
    private readonly chain: ChainPort,
    private readonly clock: ClockPort,
    private readonly options: WorkerOptions,
  ) {}

  async runOnce(): Promise<number> {
    const jobs = await this.queue.claim(this.options.workerId, this.options.batchSize, this.options.leaseSeconds);
    for (const job of jobs) await this.processSafely(job);
    return jobs.length;
  }

  private async processSafely(job: BlockchainJob): Promise<void> {
    try {
      await this.process(job);
    } catch (error) {
      const classified = classifyError(error);
      await this.queue.retry(job, classified.code, classified.message, classified.retryable);
    }
  }

  private async process(job: BlockchainJob): Promise<void> {
    const payload = parseJobPayload(job);
    const existing = await this.chain.findExisting(job.entityType, payload);
    if (existing) {
      await this.queue.complete(job, existing.txHash, existing.tokenId);
      return;
    }

    let submission = payload.workerSubmission;
    if (!submission) {
      if (job.txHash) {
        throw new WorkerError("MISSING_SIGNED_TRANSACTION", `Job ${job.id} has tx_hash but no recoverable signed transaction; awaiting chain reconciliation`, true);
      }
      const document = renderMetadata(job, payload, this.options.assetBaseUri);
      const metadataUri = await this.metadata.pin(document, job.operationKey);
      submission = await this.chain.prepare(job.entityType, payload, metadataUri);
      job = await this.queue.recordPrepared(job, submission);
    }

    const broadcastHash = await this.chain.broadcast(submission.signedTransaction);
    if (broadcastHash.toLowerCase() !== submission.txHash.toLowerCase()) {
      throw new WorkerError("TRANSACTION_HASH_MISMATCH", `Broadcast hash ${broadcastHash} did not match prepared hash ${submission.txHash}`, false);
    }
    for (let attempt = 0; attempt < this.options.receiptPollAttempts; attempt += 1) {
      const receipt = await this.chain.receipt(submission.txHash);
      if (receipt) {
        await this.queue.complete(job, receipt.txHash, receipt.tokenId);
        return;
      }
      if (attempt + 1 < this.options.receiptPollAttempts) {
        await this.clock.sleep(this.options.receiptPollIntervalMs);
      }
    }
    throw new Error(`Receipt was not available for ${submission.txHash}`);
  }
}
