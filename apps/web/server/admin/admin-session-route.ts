import "server-only";

import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AdminSession } from "./admin-session-gate";

interface AdminSessionHandlerDependencies {
  authorize(input: { authorization: string; correlationId: string }): Promise<AdminSession>;
}

function correlationId(request: Request): string {
  const provided = request.headers.get("x-correlation-id")?.trim();
  return provided && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(provided)
    ? provided
    : crypto.randomUUID();
}

function errorResponse(status: 401 | 403): Response {
  return Response.json(
    { error: { code: status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export function createAdminSessionHandler(dependencies: AdminSessionHandlerDependencies) {
  return async function GET(request: Request): Promise<Response> {
    try {
      const admin = await dependencies.authorize({
        authorization: request.headers.get("authorization") ?? "",
        correlationId: correlationId(request),
      });
      return Response.json(
        { admin },
        { status: 200, headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      if (error instanceof AuthError) {
        return errorResponse(error.status === 401 ? 401 : 403);
      }
      throw error;
    }
  };
}
