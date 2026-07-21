import "server-only";

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { deriveCredentialId } from "../../features/passport/domain/credential-issuance";
import {
  projectAtomicAttendanceResult,
  type CreateLiveAttendanceResponse,
} from "../../features/live/domain/live-attendance";

export type LiveAttendanceFailureCode =
  | "LIVE_NOT_FOUND"
  | "PASSPORT_REQUIRED"
  | "ATTENDANCE_CODE_INVALID"
  | "ATTENDANCE_RATE_LIMITED"
  | "WALLET_NOT_READY"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "USER_UNAVAILABLE"
  | "ATTENDANCE_INTEGRITY_ERROR";

export class LiveAttendanceRepositoryError extends Error {
  constructor(readonly code: LiveAttendanceFailureCode) {
    super(code);
    this.name = "LiveAttendanceRepositoryError";
  }
}

export interface LiveAttendanceRepository {
  attend(input: {
    appUserId: string;
    liveSlug: string;
    idempotencyKey: string;
    normalizedCode: string;
    inputFormatValid: boolean;
  }): Promise<CreateLiveAttendanceResponse>;
}

interface RpcClient {
  rpc(name: string, parameters: Record<string, string | boolean>): PromiseLike<{
    data: unknown;
    error: { message?: string; code?: string } | null;
  }>;
}

const failureMap: Readonly<Record<string, LiveAttendanceFailureCode>> = {
  G3_ATTENDANCE_LIVE_NOT_FOUND: "LIVE_NOT_FOUND",
  G3_ATTENDANCE_PASSPORT_REQUIRED: "PASSPORT_REQUIRED",
  G3_ATTENDANCE_CODE_INVALID: "ATTENDANCE_CODE_INVALID",
  G3_ATTENDANCE_RATE_LIMITED: "ATTENDANCE_RATE_LIMITED",
  G3_ATTENDANCE_WALLET_NOT_READY: "WALLET_NOT_READY",
  G3_ATTENDANCE_IDEMPOTENCY_KEY_CONFLICT: "IDEMPOTENCY_KEY_CONFLICT",
  G3_ATTENDANCE_USER_UNAVAILABLE: "USER_UNAVAILABLE",
};

function mapFailure(error: { message?: string }): LiveAttendanceRepositoryError {
  const marker = Object.keys(failureMap).find((value) => error.message?.includes(value));
  return new LiveAttendanceRepositoryError(marker ? failureMap[marker] : "ATTENDANCE_INTEGRITY_ERROR");
}

export class SupabaseLiveAttendanceRepository implements LiveAttendanceRepository {
  constructor(private readonly client: RpcClient, private readonly createId: () => string = randomUUID) {}

  async attend(input: {
    appUserId: string;
    liveSlug: string;
    idempotencyKey: string;
    normalizedCode: string;
    inputFormatValid: boolean;
  }): Promise<CreateLiveAttendanceResponse> {
    const stampId = this.createId();
    const operationKey = `byus:stamp:v1:${stampId}`;
    const { data, error } = await this.client.rpc("attend_owned_live_event", {
      p_app_user_id: input.appUserId,
      p_live_slug: input.liveSlug,
      p_idempotency_key: input.idempotencyKey,
      p_normalized_code: input.normalizedCode,
      p_input_format_valid: input.inputFormatValid,
      p_stamp_id: stampId,
      p_stamp_operation_key: operationKey,
      p_stamp_issuance_id: deriveCredentialId(operationKey),
    });
    if (error) throw mapFailure(error);
    if (typeof data === "object" && data !== null && "errorCode" in data) {
      throw mapFailure({ message: String(data.errorCode) });
    }
    try {
      return projectAtomicAttendanceResult(data);
    } catch {
      throw new LiveAttendanceRepositoryError("ATTENDANCE_INTEGRITY_ERROR");
    }
  }
}

export function createLiveAttendanceRepositoryFromEnvironment(config: {
  url: string;
  serviceRoleKey: string;
}): LiveAttendanceRepository {
  const client = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return new SupabaseLiveAttendanceRepository(client as unknown as RpcClient);
}
