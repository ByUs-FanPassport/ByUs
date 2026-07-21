import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type AdminFanActor = { appUserId: string; allowlistId: string };
export type FanCursor = { createdAt: string; id: string };
export const MAX_FAN_SCORE = 1_000_000;
export type FanSummary = {
  fanId: string;
  nickname: string | null;
  accountStatus: "active" | "disabled";
  maskedWallet: string | null;
  createdAt: string;
  celebritySummaries: Array<Record<string, unknown>>;
  cursor: FanCursor;
};
export type FanDetail = {
  fanId: string;
  nickname: string | null;
  accountStatus: "active" | "disabled";
  createdAt: string;
  wallets: Array<Record<string, unknown>>;
  passports: Array<Record<string, unknown>>;
};
export type FanScoreAdjustment = {
  adjustmentId: string;
  points: number;
  resultingScore: number;
  createdAt: string;
};

export class FanOperationsRepositoryError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "INVALID"
      | "CONFLICT"
      | "TARGET_UNAVAILABLE"
      | "NEGATIVE_SCORE"
      | "SCORE_LIMIT"
      | "UNAVAILABLE",
  ) {
    super(code);
    this.name = "FanOperationsRepositoryError";
  }
}

export interface FanOperationsRepository {
  list(input: {
    actor: AdminFanActor;
    correlationId: string;
    locale: "ko" | "en";
    query: string | null;
    celebrityId: string | null;
    accountStatus: "active" | "disabled" | null;
    cursor: FanCursor | null;
    limit: number;
  }): Promise<{ items: FanSummary[]; nextCursor: FanCursor | null }>;
  detail(input: {
    actor: AdminFanActor;
    correlationId: string;
    fanId: string;
    locale: "ko" | "en";
  }): Promise<FanDetail>;
  adjust(input: {
    actor: AdminFanActor;
    correlationId: string;
    fanId: string;
    celebrityId: string;
    points: number;
    reason: string;
    idempotencyKey: string;
  }): Promise<FanScoreAdjustment>;
}

type RpcClient = Pick<SupabaseClient, "rpc">;
function classify(message: string): FanOperationsRepositoryError {
  if (message.includes("fan not found"))
    return new FanOperationsRepositoryError("NOT_FOUND");
  if (
    message.includes("FORBIDDEN") ||
    message.includes("administrator is required")
  )
    return new FanOperationsRepositoryError("FORBIDDEN");
  if (message.includes("IDEMPOTENCY_CONFLICT"))
    return new FanOperationsRepositoryError("CONFLICT");
  if (message.includes("TARGET_UNAVAILABLE"))
    return new FanOperationsRepositoryError("TARGET_UNAVAILABLE");
  if (message.includes("NEGATIVE_SCORE"))
    return new FanOperationsRepositoryError("NEGATIVE_SCORE");
  if (
    message.includes("SCORE_LIMIT") ||
    message.includes("score total must remain")
  )
    return new FanOperationsRepositoryError("SCORE_LIMIT");
  if (message.includes("INVALID") || message.includes("invalid fan operations"))
    return new FanOperationsRepositoryError("INVALID");
  return new FanOperationsRepositoryError("UNAVAILABLE");
}
function rpcData<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw classify(error.message);
  return data as T;
}
function scoreAdjustmentData(
  data: unknown,
  error: { message: string } | null,
): FanScoreAdjustment {
  const value = rpcData<FanScoreAdjustment>(data, error);
  if (
    !Number.isInteger(value.resultingScore) ||
    value.resultingScore < 0 ||
    value.resultingScore > MAX_FAN_SCORE
  ) {
    throw new FanOperationsRepositoryError("UNAVAILABLE");
  }
  return value;
}

export function createSupabaseFanOperationsRepository(
  config: { url: string; serviceRoleKey: string },
  client?: RpcClient,
): FanOperationsRepository {
  const database =
    client ??
    createClient(config.url, config.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  return {
    async list(input) {
      const { data, error } = await database.rpc("get_admin_fans", {
        p_actor_app_user_id: input.actor.appUserId,
        p_actor_admin_allowlist_id: input.actor.allowlistId,
        p_correlation_id: input.correlationId,
        p_locale: input.locale,
        p_query: input.query,
        p_celebrity_id: input.celebrityId,
        p_account_status: input.accountStatus,
        p_cursor_created_at: input.cursor?.createdAt ?? null,
        p_cursor_id: input.cursor?.id ?? null,
        p_limit: input.limit,
      });
      const items = rpcData<FanSummary[]>(data ?? [], error);
      return {
        items,
        nextCursor:
          items.length === input.limit ? (items.at(-1)?.cursor ?? null) : null,
      };
    },
    async detail(input) {
      const { data, error } = await database.rpc("get_admin_fan_detail", {
        p_actor_app_user_id: input.actor.appUserId,
        p_actor_admin_allowlist_id: input.actor.allowlistId,
        p_correlation_id: input.correlationId,
        p_fan_id: input.fanId,
        p_locale: input.locale,
      });
      return rpcData<FanDetail>(data, error);
    },
    async adjust(input) {
      const { data, error } = await database.rpc("admin_adjust_fan_score", {
        p_actor_app_user_id: input.actor.appUserId,
        p_actor_admin_allowlist_id: input.actor.allowlistId,
        p_correlation_id: input.correlationId,
        p_fan_id: input.fanId,
        p_celebrity_id: input.celebrityId,
        p_points: input.points,
        p_reason: input.reason,
        p_idempotency_key: input.idempotencyKey,
      });
      return scoreAdjustmentData(data, error);
    },
  };
}
