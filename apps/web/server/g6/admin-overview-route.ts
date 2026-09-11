import "server-only";
import { overviewDaysSchema } from "../../features/analytics/domain/admin-overview";
import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AdminSession } from "../admin/admin-session-gate";
import { AdminOverviewRepositoryError, type AdminOverviewRepository } from "./admin-overview-repository";

const headers = { "cache-control": "private, no-store", vary: "Authorization" };
export function createGetAdminOverviewHandler(dependencies: {
  authorize(input: { authorization: string; correlationId: string }): Promise<AdminSession>;
  repository: AdminOverviewRepository;
  now?: () => Date;
}) {
  return async (request: Request) => {
    try {
      const admin = await dependencies.authorize({ authorization: request.headers.get("authorization") ?? "", correlationId: crypto.randomUUID() });
      const params = new URL(request.url).searchParams;
      const days = overviewDaysSchema.safeParse(params.get("days") ?? "30");
      if (!days.success || [...params.keys()].some((key) => key !== "days" || params.getAll(key).length !== 1)) {
        return Response.json({ error: { code: "INVALID_QUERY" } }, { status: 400, headers });
      }
      const data = await dependencies.repository.read({ adminAppUserId: admin.appUserId, adminAllowlistId: admin.allowlistId, days: days.data, asOf: (dependencies.now?.() ?? new Date()).toISOString() });
      return Response.json(data, { headers });
    } catch (error) {
      if (error instanceof AuthError) return Response.json({ error: { code: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" } }, { status: error.status, headers });
      if (error instanceof AdminOverviewRepositoryError) return Response.json({ error: { code: "ADMIN_OVERVIEW_UNAVAILABLE" } }, { status: 503, headers });
      throw error;
    }
  };
}
