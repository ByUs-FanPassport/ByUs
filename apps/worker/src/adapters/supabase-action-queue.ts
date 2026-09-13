import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalActionPayloadV1, FanActionJob } from "../action-domain.js";
import type { ActionQueuePort, ActionReceipt } from "../action-ports.js";
import type { PreparedSubmission } from "../domain.js";
import { WorkerError } from "../domain.js";

type Row = Record<string, unknown>;

function mapRow(row: Row): FanActionJob {
  return {
    id: String(row.id),
    occurrenceRowId: String(row.occurrence_row_id),
    payloadVersion: Number(row.payload_version),
    sourceSnapshot: row.source_snapshot,
    payload: row.payload ?? null,
    actionId: row.action_id == null ? null : String(row.action_id),
    requestHash: row.request_hash == null ? null : String(row.request_hash),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    txHash: row.tx_hash == null ? null : String(row.tx_hash),
    signedTransaction: row.signed_transaction == null ? null : String(row.signed_transaction),
    leaseOwner: String(row.lease_owner),
    leaseExpiresAt: String(row.lease_expires_at),
  };
}

function dbError(operation: string, error: { message: string; code?: string }): WorkerError {
  return new WorkerError("ACTION_QUEUE_DATABASE_ERROR", `${operation}: ${error.message}`, true, { cause: error });
}

function receiptJson(receipt: ActionReceipt): Record<string, unknown> {
  return {
    txHash: receipt.txHash,
    blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash,
    transactionIndex: receipt.transactionIndex,
    hubLogIndex: receipt.hubLogIndex,
    easUid: receipt.easUid,
    recordHash: receipt.recordHash,
    credentialRefsHash: receipt.credentialRefsHash,
    credentials: receipt.credentials.map((credential) => ({
      ...credential,
      tokenId: credential.tokenId.toString(),
    })),
    inclusionStatus: receipt.inclusionStatus,
  };
}

export class SupabaseActionQueueAdapter implements ActionQueuePort {
  constructor(private readonly client: SupabaseClient, private readonly operationKinds: readonly string[] = ["record_only", "record_and_issue"]) {}

  static create(url: string, serviceRoleKey: string, operationKinds?: readonly string[]): SupabaseActionQueueAdapter {
    return new SupabaseActionQueueAdapter(createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }), operationKinds);
  }

  async claim(workerId: string, batchSize: number, leaseSeconds: number): Promise<FanActionJob[]> {
    const { data, error } = await this.client.rpc("claim_fan_action_jobs", {
      p_worker_id: workerId,
      p_batch_size: batchSize,
      p_lease_seconds: leaseSeconds,
      p_operation_kinds: [...this.operationKinds],
    });
    if (error) throw dbError("claim_fan_action_jobs", error);
    return ((data ?? []) as Row[]).map(mapRow);
  }

  async admitDispatch(job: FanActionJob): Promise<boolean> {
    const { data, error } = await this.client.rpc("admit_fan_action_dispatch", {
      p_job_id: job.id,
      p_worker_id: job.leaseOwner,
    });
    if (error) throw dbError("admit_fan_action_dispatch", error);
    if (typeof data !== "boolean") throw dbError("admit_fan_action_dispatch", { message: "database returned no admission decision" });
    return data;
  }

  async admitWriter(job: FanActionJob, chainId: number, relayer: string, leaseSeconds: number): Promise<boolean> {
    const { data, error } = await this.client.rpc("admit_chain_writer", {
      p_job_family: "fan_action",
      p_job_id: job.id,
      p_worker_id: job.leaseOwner,
      p_chain_id: chainId,
      p_relayer: relayer.toLowerCase(),
      p_lease_seconds: leaseSeconds,
    });
    if (error) throw dbError("admit_chain_writer", error);
    if (typeof data !== "boolean") throw dbError("admit_chain_writer", { message: "database returned no admission decision" });
    return data;
  }

  async releaseWriter(job: FanActionJob, chainId: number, relayer: string): Promise<void> {
    const { error } = await this.client.rpc("release_chain_writer", {
      p_job_family: "fan_action",
      p_job_id: job.id,
      p_worker_id: job.leaseOwner,
      p_chain_id: chainId,
      p_relayer: relayer.toLowerCase(),
    });
    if (error) throw dbError("release_chain_writer", error);
  }

  async prepareCanonical(job: FanActionJob, payload: CanonicalActionPayloadV1): Promise<FanActionJob> {
    const { data, error } = await this.client.rpc("prepare_fan_action_job", {
      p_job_id: job.id,
      p_worker_id: job.leaseOwner,
      p_payload: payload,
    });
    if (error) throw dbError("prepare_fan_action_job", error);
    if (!data) throw new WorkerError("STALE_ACTION_JOB_LEASE", "Cannot freeze canonical payload because the lease is no longer active", true);
    return mapRow(data as Row);
  }

  async recordPrepared(job: FanActionJob, submission: PreparedSubmission): Promise<FanActionJob> {
    const { data, error } = await this.client.rpc("record_prepared_fan_action_job", {
      p_job_id: job.id,
      p_worker_id: job.leaseOwner,
      p_tx_hash: submission.txHash,
      p_signed_transaction: submission.signedTransaction,
    });
    if (error) throw dbError("record_prepared_fan_action_job", error);
    if (!data) throw new WorkerError("STALE_ACTION_JOB_LEASE", "Cannot record action transaction because the lease is no longer active", true);
    return mapRow(data as Row);
  }

  async complete(job: FanActionJob, receipt: ActionReceipt): Promise<void> {
    const { error } = await this.client.rpc("complete_fan_action_job", {
      p_job_id: job.id,
      p_worker_id: job.leaseOwner,
      p_receipt: receiptJson(receipt),
    });
    if (error) throw dbError("complete_fan_action_job", error);
  }

  async retry(job: FanActionJob, code: string, message: string, retryable: boolean): Promise<void> {
    const { error } = await this.client.rpc("retry_fan_action_job", {
      p_job_id: job.id,
      p_worker_id: job.leaseOwner,
      p_error_code: code,
      p_error_message: message,
      p_retryable: retryable,
    });
    if (error) throw dbError("retry_fan_action_job", error);
  }
}
