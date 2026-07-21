import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { WorkerError, type BlockchainJob, type PreparedSubmission } from "../domain.js";
import type { QueuePort } from "../ports.js";

type Row = Record<string, unknown>;

function mapRow(row: Row): BlockchainJob {
  return {
    id: String(row.id),
    entityType: row.entity_type as BlockchainJob["entityType"],
    entityId: String(row.entity_id),
    operationKey: String(row.operation_key),
    payloadVersion: Number(row.payload_version),
    payload: row.payload,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    txHash: row.tx_hash === null ? null : String(row.tx_hash),
    leaseOwner: String(row.lease_owner),
    leaseExpiresAt: String(row.lease_expires_at),
  };
}

function dbError(operation: string, error: { message: string; code?: string }): WorkerError {
  return new WorkerError("QUEUE_DATABASE_ERROR", `${operation}: ${error.message}`, true, { cause: error });
}

export class SupabaseQueueAdapter implements QueuePort {
  constructor(private readonly client: SupabaseClient) {}

  static create(url: string, serviceRoleKey: string): SupabaseQueueAdapter {
    return new SupabaseQueueAdapter(createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }));
  }

  async claim(workerId: string, batchSize: number, leaseSeconds: number): Promise<BlockchainJob[]> {
    const { data, error } = await this.client.rpc("claim_blockchain_jobs", {
      p_worker_id: workerId,
      p_batch_size: batchSize,
      p_lease_seconds: leaseSeconds,
    });
    if (error) throw dbError("claim_blockchain_jobs", error);
    return ((data ?? []) as Row[]).map(mapRow);
  }

  async recordPrepared(job: BlockchainJob, submission: PreparedSubmission): Promise<BlockchainJob> {
    const { data, error } = await this.client.rpc("record_prepared_blockchain_job", {
      p_job_id: job.id,
      p_worker_id: job.leaseOwner,
      p_tx_hash: submission.txHash,
      p_signed_transaction: submission.signedTransaction,
    });
    if (error) throw dbError("record_prepared_blockchain_job", error);
    if (!data) throw new WorkerError("STALE_JOB_LEASE", "Cannot record transaction because the lease is no longer active", true);
    return mapRow(data as Row);
  }

  async complete(job: BlockchainJob, txHash: string, tokenId: bigint): Promise<void> {
    const { error } = await this.client.rpc("complete_blockchain_job", {
      p_job_id: job.id,
      p_worker_id: job.leaseOwner,
      p_tx_hash: txHash,
      p_token_id: tokenId.toString(),
    });
    if (error) throw dbError("complete_blockchain_job", error);
  }

  async retry(job: BlockchainJob, code: string, message: string, retryable: boolean): Promise<void> {
    const { error } = await this.client.rpc("retry_blockchain_job", {
      p_job_id: job.id,
      p_worker_id: job.leaseOwner,
      p_error_code: code,
      p_error_message: message,
      p_retryable: retryable,
    });
    if (error) throw dbError("retry_blockchain_job", error);
  }
}
