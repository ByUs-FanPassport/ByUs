import "server-only";

import { z } from "zod";
import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AdminSession } from "../admin/admin-session-gate";
import {
  AnalyticsRepositoryError,
  type AnalyticsQuery,
  type AnalyticsRepository,
} from "./analytics-repository";

const uuid = z.string().uuid();
const date = z.string().datetime({ offset: true });
const privateHeaders = {
  "cache-control": "private, no-store",
  vary: "Authorization",
};
interface Dependencies {
  authorize(input: {
    authorization: string;
    correlationId: string;
  }): Promise<AdminSession>;
  repository: AnalyticsRepository;
}

function correlationId(request: Request): string {
  const value = request.headers.get("x-correlation-id")?.trim();
  return value && uuid.safeParse(value).success ? value : crypto.randomUUID();
}
function parse(
  request: Request,
  scopeKey: "celebrity" | "brand",
): AnalyticsQuery & Record<"scopeId", string> {
  const query = new URL(request.url).searchParams;
  const allowed = new Set([scopeKey, "live", "from", "to", "asOf"]);
  for (const key of query.keys())
    if (!allowed.has(key) || query.getAll(key).length !== 1)
      throw new Error("INVALID_QUERY");
  const parsed = z
    .object({
      scopeId: uuid,
      liveEventId: uuid.optional(),
      from: date,
      to: date,
      asOf: date,
    })
    .safeParse({
      scopeId: query.get(scopeKey),
      liveEventId: query.get("live") ?? undefined,
      from: query.get("from"),
      to: query.get("to"),
      asOf: query.get("asOf"),
    });
  if (!parsed.success) throw new Error("INVALID_QUERY");
  const normalized = {
    ...parsed.data,
    from: new Date(parsed.data.from).toISOString(),
    to: new Date(parsed.data.to).toISOString(),
    asOf: new Date(parsed.data.asOf).toISOString(),
  };
  if (
    normalized.from >= normalized.to ||
    normalized.to > normalized.asOf ||
    new Date(normalized.to).getTime() - new Date(normalized.from).getTime() >
      366 * 24 * 60 * 60 * 1000
  )
    throw new Error("INVALID_QUERY");
  return normalized;
}
function failure(status: 400 | 401 | 403 | 503, code: string) {
  return Response.json(
    { error: { code } },
    { status, headers: privateHeaders },
  );
}
function mapError(caught: unknown): Response | undefined {
  if (caught instanceof AuthError)
    return failure(
      caught.status === 401 ? 401 : 403,
      caught.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN",
    );
  if (caught instanceof AnalyticsRepositoryError)
    return failure(503, "ANALYTICS_UNAVAILABLE");
  if (caught instanceof Error && caught.message === "INVALID_QUERY")
    return failure(400, "INVALID_QUERY");
}

export function createGetCreatorAnalyticsHandler(dependencies: Dependencies) {
  return async (request: Request): Promise<Response> => {
    try {
      const query = parse(request, "celebrity");
      const admin = await dependencies.authorize({
        authorization: request.headers.get("authorization") ?? "",
        correlationId: correlationId(request),
      });
      const data = await dependencies.repository.readCreator({
        adminAppUserId: admin.appUserId,
        adminAllowlistId: admin.allowlistId,
        celebrityId: query.scopeId,
        ...query,
      });
      return Response.json(data, { status: 200, headers: privateHeaders });
    } catch (caught) {
      const response = mapError(caught);
      if (response) return response;
      throw caught;
    }
  };
}
export function createGetBrandAnalyticsHandler(dependencies: Dependencies) {
  return async (request: Request): Promise<Response> => {
    try {
      const query = parse(request, "brand");
      const admin = await dependencies.authorize({
        authorization: request.headers.get("authorization") ?? "",
        correlationId: correlationId(request),
      });
      const data = await dependencies.repository.readBrand({
        adminAppUserId: admin.appUserId,
        adminAllowlistId: admin.allowlistId,
        brandId: query.scopeId,
        ...query,
      });
      return Response.json(data, { status: 200, headers: privateHeaders });
    } catch (caught) {
      const response = mapError(caught);
      if (response) return response;
      throw caught;
    }
  };
}
