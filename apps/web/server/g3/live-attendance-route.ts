import "server-only";

import { AuthError } from "../../features/auth/domain/auth-errors";
import {
  createLiveAttendanceRequestSchema,
  isNormalizedFanCodeValid,
  normalizeFanCode,
} from "../../features/live/domain/live-attendance";
import { FanAuthUnavailableError } from "../fan-auth/fan-auth-gate";
import {
  LiveAttendanceRepositoryError,
  type LiveAttendanceFailureCode,
  type LiveAttendanceRepository,
} from "./live-attendance-repository";

export interface LiveAttendanceRouteDependencies {
  authorize(authorization: string | null): Promise<{ appUserId: string }>;
  repository: LiveAttendanceRepository;
}

const failures: Readonly<Record<LiveAttendanceFailureCode, { code: string; status: number }>> = {
  LIVE_NOT_FOUND: { code: "LIVE_NOT_FOUND", status: 404 },
  PASSPORT_REQUIRED: { code: "PASSPORT_REQUIRED", status: 403 },
  ATTENDANCE_CODE_INVALID: { code: "ATTENDANCE_CODE_INVALID", status: 422 },
  ATTENDANCE_RATE_LIMITED: { code: "ATTENDANCE_RATE_LIMITED", status: 429 },
  WALLET_NOT_READY: { code: "WALLET_NOT_READY", status: 409 },
  IDEMPOTENCY_KEY_CONFLICT: { code: "IDEMPOTENCY_KEY_CONFLICT", status: 409 },
  USER_UNAVAILABLE: { code: "AUTHENTICATION_REQUIRED", status: 403 },
  ATTENDANCE_INTEGRITY_ERROR: { code: "ATTENDANCE_UNAVAILABLE", status: 503 },
};

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store", vary: "Authorization" },
  });
}

export function createPostLiveAttendanceHandler(dependencies: LiveAttendanceRouteDependencies) {
  return async function POST(request: Request, input: { slug: string }): Promise<Response> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)
      || !(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return json({ error: { code: "INVALID_REQUEST" } }, 400);
    }

    let owner;
    try {
      owner = await dependencies.authorize(request.headers.get("authorization"));
    } catch (error) {
      if (error instanceof FanAuthUnavailableError) {
        return json({ error: { code: "ATTENDANCE_UNAVAILABLE" } }, 503);
      }
      if (error instanceof AuthError) {
        return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, error.status);
      }
      return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
    }

    const idempotencyKey = request.headers.get("idempotency-key");
    const declaredLength = request.headers.get("content-length");
    let body;
    try {
      if (!idempotencyKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
        throw new Error("invalid key");
      }
      if (declaredLength !== null
        && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > 256)) {
        throw new Error("request too large");
      }
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > 256) {
        throw new Error("request too large");
      }
      body = createLiveAttendanceRequestSchema.parse(JSON.parse(rawBody));
    } catch {
      return json({ error: { code: "INVALID_REQUEST" } }, 400);
    }

    try {
      const normalizedCode = normalizeFanCode(body.code);
      const formatValid = isNormalizedFanCodeValid(normalizedCode);
      const result = await dependencies.repository.attend({
        appUserId: owner.appUserId,
        liveSlug: input.slug,
        idempotencyKey,
        normalizedCode: formatValid ? normalizedCode : "",
        inputFormatValid: formatValid,
      });
      return json(result, 200);
    } catch (error) {
      if (error instanceof LiveAttendanceRepositoryError) {
        const mapped = failures[error.code];
        const response = json({ error: { code: mapped.code } }, mapped.status);
        if (error.code === "ATTENDANCE_RATE_LIMITED") {
          response.headers.set("retry-after", "900");
        }
        return response;
      }
      return json({ error: { code: "ATTENDANCE_UNAVAILABLE" } }, 503);
    }
  };
}
