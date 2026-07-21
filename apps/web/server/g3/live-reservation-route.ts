import "server-only";

import { AuthError } from "../../features/auth/domain/auth-errors";
import { createLiveReservationRequestSchema } from "../../features/live/domain/live-reservation";
import { FanAuthUnavailableError } from "../fan-auth/fan-auth-gate";
import {
  LiveReservationRepositoryError,
  type LiveReservationFailureCode,
  type LiveReservationRepository,
} from "./live-reservation-repository";

export interface LiveReservationRouteDependencies {
  authorize(authorization: string | null): Promise<{ appUserId: string }>;
  repository: LiveReservationRepository;
}

const failureResponses: Readonly<
  Record<LiveReservationFailureCode, { code: string; status: number }>
> = {
  LIVE_NOT_FOUND: { code: "LIVE_NOT_FOUND", status: 404 },
  RESERVATION_UNAVAILABLE: { code: "RESERVATION_UNAVAILABLE", status: 409 },
  RESERVATION_WINDOW_CLOSED: { code: "RESERVATION_WINDOW_CLOSED", status: 409 },
  PASSPORT_REQUIRED: { code: "PASSPORT_REQUIRED", status: 403 },
  WALLET_NOT_READY: { code: "WALLET_NOT_READY", status: 409 },
  IDEMPOTENCY_KEY_CONFLICT: { code: "IDEMPOTENCY_KEY_CONFLICT", status: 409 },
  USER_UNAVAILABLE: { code: "AUTHENTICATION_REQUIRED", status: 403 },
  RESERVATION_INTEGRITY_ERROR: { code: "RESERVATION_UNAVAILABLE", status: 503 },
};

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store", vary: "Authorization" },
  });
}

export function createPostLiveReservationHandler(
  dependencies: LiveReservationRouteDependencies,
) {
  return async function POST(request: Request, input: { liveEventId: string }): Promise<Response> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.liveEventId)) {
      return json({ error: { code: "LIVE_NOT_FOUND" } }, 404);
    }
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return json({ error: { code: "INVALID_REQUEST" } }, 400);
    }

    let body;
    try {
      body = createLiveReservationRequestSchema.parse(await request.json());
    } catch {
      return json({ error: { code: "INVALID_REQUEST" } }, 400);
    }

    let owner;
    try {
      owner = await dependencies.authorize(request.headers.get("authorization"));
    } catch (error) {
      if (error instanceof FanAuthUnavailableError) {
        return json({ error: { code: "RESERVATION_UNAVAILABLE" } }, 503);
      }
      if (error instanceof AuthError) {
        return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, error.status);
      }
      return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
    }

    try {
      const result = await dependencies.repository.reserve({
        appUserId: owner.appUserId,
        liveEventId: input.liveEventId,
        idempotencyKey: body.idempotencyKey,
      });
      return json(result, 200);
    } catch (error) {
      if (error instanceof LiveReservationRepositoryError) {
        const mapped = failureResponses[error.code];
        return json({ error: { code: mapped.code } }, mapped.status);
      }
      return json({ error: { code: "RESERVATION_UNAVAILABLE" } }, 503);
    }
  };
}
