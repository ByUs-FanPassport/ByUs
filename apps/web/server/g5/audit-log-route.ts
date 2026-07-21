import "server-only";

import { z } from "zod";

import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AdminSession } from "../admin/admin-session-gate";
import {
  AuditLogRepositoryError,
  type AuditLogCursor,
  type AuditLogFilters,
  type AuditLogRepository,
} from "./audit-log-repository";

const uuid = z.string().uuid();
const safeText = z.string().trim().min(1).max(160);
const cursorSchema = z.object({ createdAt: z.string().datetime({ offset: true }), id: z.string().regex(/^[1-9][0-9]*$/) }).strict();
const allowedQueryParameters = new Set([
  "limit", "cursor", "actor", "entityType", "entityId", "action", "result", "from", "to", "correlation",
]);
const privateHeaders = { "cache-control": "private, no-store", vary: "Authorization" };

interface AuditLogRouteDependencies {
  authorize(input: { authorization: string; correlationId: string }): Promise<AdminSession>;
  repository: AuditLogRepository;
}

function requestCorrelationId(request: Request): string {
  const candidate = request.headers.get("x-correlation-id")?.trim();
  return candidate && uuid.safeParse(candidate).success ? candidate : crypto.randomUUID();
}

function decodeCursor(value: string): AuditLogCursor {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch {
    throw new Error("INVALID_QUERY");
  }
}

function encodeCursor(value: AuditLogCursor | null): string | null {
  return value ? Buffer.from(JSON.stringify(value), "utf8").toString("base64url") : null;
}

function optionalDate(value: string | null): string | undefined {
  if (value === null) return undefined;
  const parsed = z.string().datetime({ offset: true }).safeParse(value);
  if (!parsed.success) throw new Error("INVALID_QUERY");
  return new Date(parsed.data).toISOString();
}

function parseQuery(request: Request): { limit: number; cursor?: AuditLogCursor; filters: AuditLogFilters } {
  const parameters = new URL(request.url).searchParams;
  for (const key of parameters.keys()) {
    if (!allowedQueryParameters.has(key) || parameters.getAll(key).length !== 1) throw new Error("INVALID_QUERY");
  }
  const limitResult = z.coerce.number().int().min(1).max(99).safeParse(parameters.get("limit") ?? "50");
  if (!limitResult.success) throw new Error("INVALID_QUERY");

  const parseOptional = <T>(name: string, schema: z.ZodType<T>): T | undefined => {
    const value = parameters.get(name);
    if (value === null) return undefined;
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new Error("INVALID_QUERY");
    return parsed.data;
  };
  const createdFrom = optionalDate(parameters.get("from"));
  const createdTo = optionalDate(parameters.get("to"));
  if (createdFrom && createdTo && createdFrom > createdTo) throw new Error("INVALID_QUERY");
  const cursorValue = parameters.get("cursor");
  return {
    limit: limitResult.data,
    cursor: cursorValue ? decodeCursor(cursorValue) : undefined,
    filters: {
      actorId: parseOptional("actor", uuid),
      entityType: parseOptional("entityType", safeText),
      entityId: parseOptional("entityId", z.string().trim().min(1).max(256)),
      action: parseOptional("action", safeText),
      result: parseOptional("result", safeText),
      createdFrom,
      createdTo,
      correlationId: parseOptional("correlation", uuid),
    },
  };
}

function error(status: 400 | 401 | 403 | 503, code: string): Response {
  return Response.json({ error: { code } }, { status, headers: privateHeaders });
}

export function createGetAuditLogsHandler(dependencies: AuditLogRouteDependencies) {
  return async function GET(request: Request): Promise<Response> {
    try {
      const query = parseQuery(request);
      const admin = await dependencies.authorize({
        authorization: request.headers.get("authorization") ?? "",
        correlationId: requestCorrelationId(request),
      });
      const page = await dependencies.repository.read({
        adminAllowlistId: admin.allowlistId,
        ...query,
      });
      return Response.json(
        { items: page.items, nextCursor: encodeCursor(page.nextCursor) },
        { status: 200, headers: privateHeaders },
      );
    } catch (caught) {
      if (caught instanceof AuthError) return error(caught.status === 401 ? 401 : 403, caught.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
      if (caught instanceof AuditLogRepositoryError) return error(503, "AUDIT_LOGS_UNAVAILABLE");
      if (caught instanceof Error && caught.message === "INVALID_QUERY") return error(400, "INVALID_QUERY");
      throw caught;
    }
  };
}
