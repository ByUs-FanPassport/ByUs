import "server-only";

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { deriveCredentialId } from "../../features/passport/domain/credential-issuance";
import {
  projectAtomicReservationResult,
  type CreateLiveReservationResponse,
} from "../../features/live/domain/live-reservation";

export type LiveReservationFailureCode =
  | "LIVE_NOT_FOUND"
  | "RESERVATION_UNAVAILABLE"
  | "RESERVATION_WINDOW_CLOSED"
  | "PASSPORT_REQUIRED"
  | "WALLET_NOT_READY"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "USER_UNAVAILABLE"
  | "RESERVATION_INTEGRITY_ERROR";

export class LiveReservationRepositoryError extends Error {
  constructor(readonly code: LiveReservationFailureCode) {
    super(code);
    this.name = "LiveReservationRepositoryError";
  }
}

export interface LiveReservationRepository {
  reserve(input: {
    appUserId: string;
    liveEventId: string;
    idempotencyKey: string;
  }): Promise<CreateLiveReservationResponse>;
}

interface RpcClient {
  rpc(
    name: string,
    parameters: Record<string, string>,
  ): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
}

const rpcFailureMap: Readonly<Record<string, LiveReservationFailureCode>> = {
  G3_LIVE_NOT_FOUND: "LIVE_NOT_FOUND",
  G3_RESERVATION_UNAVAILABLE: "RESERVATION_UNAVAILABLE",
  G3_RESERVATION_WINDOW_CLOSED: "RESERVATION_WINDOW_CLOSED",
  G3_PASSPORT_REQUIRED: "PASSPORT_REQUIRED",
  G3_WALLET_NOT_READY: "WALLET_NOT_READY",
  G3_IDEMPOTENCY_KEY_CONFLICT: "IDEMPOTENCY_KEY_CONFLICT",
  G3_USER_UNAVAILABLE: "USER_UNAVAILABLE",
  G3_RESERVATION_INTEGRITY_ERROR: "RESERVATION_INTEGRITY_ERROR",
  G3_ISSUANCE_CONFLICT: "RESERVATION_INTEGRITY_ERROR",
  G3_ISSUANCE_INPUT_INVALID: "RESERVATION_INTEGRITY_ERROR",
  G3_RESERVATION_INPUT_INVALID: "RESERVATION_INTEGRITY_ERROR",
};

function mapRpcFailure(error: { message?: string }): LiveReservationRepositoryError {
  const marker = Object.keys(rpcFailureMap).find((candidate) =>
    error.message?.includes(candidate),
  );
  return new LiveReservationRepositoryError(
    marker ? rpcFailureMap[marker] : "RESERVATION_INTEGRITY_ERROR",
  );
}

export class SupabaseLiveReservationRepository implements LiveReservationRepository {
  constructor(
    private readonly client: RpcClient,
    private readonly createId: () => string = randomUUID,
  ) {}

  async reserve(input: {
    appUserId: string;
    liveEventId: string;
    idempotencyKey: string;
  }): Promise<CreateLiveReservationResponse> {
    const stampId = this.createId();
    const operationKey = `byus:stamp:v1:${stampId}`;
    const { data, error } = await this.client.rpc("reserve_owned_live_event", {
      p_app_user_id: input.appUserId,
      p_live_event_id: input.liveEventId,
      p_idempotency_key: input.idempotencyKey,
      p_stamp_id: stampId,
      p_stamp_operation_key: operationKey,
      p_stamp_issuance_id: deriveCredentialId(operationKey),
    });
    if (error) throw mapRpcFailure(error);
    try {
      return projectAtomicReservationResult(data);
    } catch {
      throw new LiveReservationRepositoryError("RESERVATION_INTEGRITY_ERROR");
    }
  }
}

export function createLiveReservationRepositoryFromEnvironment(config: {
  url: string;
  serviceRoleKey: string;
}): LiveReservationRepository {
  const client = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return new SupabaseLiveReservationRepository(client as unknown as RpcClient);
}
