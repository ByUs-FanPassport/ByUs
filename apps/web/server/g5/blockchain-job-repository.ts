import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type BlockchainJobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "RETRYING" | "FAILED";

export interface AdminJobActor {
  appUserId: string;
  allowlistId: string;
}

export interface AdminBlockchainJob {
  id: string;
  entityType: "passport" | "stamp";
  entityId: string;
  status: BlockchainJobStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  transactionReference: string | null;
  chainState: "not_submitted" | "prepared_reconciliation_required" | "confirmed";
  errorCode: string | null;
  errorSummary: string | null;
  manuallyRetryable: boolean;
  attemptHistory: Array<{
    attemptNumber: number;
    event: string;
    fromStatus: BlockchainJobStatus | null;
    toStatus: BlockchainJobStatus;
    errorCode: string | null;
    createdAt: string;
    correlationId: string | null;
  }>;
}

export class BlockchainJobRepositoryError extends Error {
  constructor(readonly code: "NOT_FOUND" | "NOT_RETRYABLE" | "FORBIDDEN" | "UNAVAILABLE") {
    super(code);
    this.name = "BlockchainJobRepositoryError";
  }
}

export interface BlockchainJobRepository {
  list(input: {
    actor: AdminJobActor;
    jobId: string | null;
    status: BlockchainJobStatus | null;
    limit: number;
    beforeCreatedAt: string | null;
  }): Promise<AdminBlockchainJob[]>;
  retry(input: { actor: AdminJobActor; jobId: string; correlationId: string }): Promise<{
    id: string;
    status: "RETRYING";
    attempts: number;
    maxAttempts: number;
    nextAttemptAt: string;
    chainState: "not_submitted" | "prepared_reconciliation_required";
  }>;
}

type RpcClient = Pick<SupabaseClient, "rpc">;
type Row = Record<string, unknown>;

function mapJob(row: Row): AdminBlockchainJob {
  return {
    id: String(row.id),
    entityType: row.entity_type as AdminBlockchainJob["entityType"],
    entityId: String(row.entity_id),
    status: row.status as BlockchainJobStatus,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    nextAttemptAt: String(row.next_attempt_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at === null ? null : String(row.completed_at),
    transactionReference: row.transaction_reference === null ? null : String(row.transaction_reference),
    chainState: row.chain_state as AdminBlockchainJob["chainState"],
    errorCode: row.safe_error_code === null ? null : String(row.safe_error_code),
    errorSummary: row.safe_error_summary === null ? null : String(row.safe_error_summary),
    manuallyRetryable: Boolean(row.manually_retryable),
    attemptHistory: Array.isArray(row.attempt_history)
      ? row.attempt_history as AdminBlockchainJob["attemptHistory"]
      : [],
  };
}

function classify(message: string): BlockchainJobRepositoryError {
  if (message.includes("not found")) return new BlockchainJobRepositoryError("NOT_FOUND");
  if (message.includes("only retryable") || message.includes("attempt limit")) {
    return new BlockchainJobRepositoryError("NOT_RETRYABLE");
  }
  if (message.includes("viewer role") || message.includes("administrator is required")) {
    return new BlockchainJobRepositoryError("FORBIDDEN");
  }
  return new BlockchainJobRepositoryError("UNAVAILABLE");
}

export function createSupabaseBlockchainJobRepository(
  config: { url: string; serviceRoleKey: string },
  client?: RpcClient,
): BlockchainJobRepository {
  const database = client ?? createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    async list(input) {
      const { data, error } = await database.rpc("get_admin_blockchain_jobs", {
        target_actor_app_user_id: input.actor.appUserId,
        target_actor_admin_allowlist_id: input.actor.allowlistId,
        target_job_id: input.jobId,
        target_status: input.status,
        target_limit: input.limit,
        target_before_created_at: input.beforeCreatedAt,
      });
      if (error) throw classify(error.message);
      return ((data ?? []) as Row[]).map(mapJob);
    },

    async retry(input) {
      const { data, error } = await database.rpc("admin_retry_blockchain_job", {
        target_job_id: input.jobId,
        target_actor_app_user_id: input.actor.appUserId,
        target_actor_admin_allowlist_id: input.actor.allowlistId,
        target_correlation_id: input.correlationId,
      });
      if (error) throw classify(error.message);
      const row = (Array.isArray(data) ? data[0] : data) as Row | null;
      if (!row) throw new BlockchainJobRepositoryError("UNAVAILABLE");
      return {
        id: String(row.id),
        status: "RETRYING",
        attempts: Number(row.attempts),
        maxAttempts: Number(row.max_attempts),
        nextAttemptAt: String(row.next_attempt_at),
        chainState: row.chain_state as "not_submitted" | "prepared_reconciliation_required",
      };
    },
  };
}
