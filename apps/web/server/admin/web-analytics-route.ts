import "server-only";

import { AuthError } from "../../features/auth/domain/auth-errors";
import { webAnalyticsDaysSchema } from "../../features/analytics/domain/web-analytics";
import type { AdminSession } from "./admin-session-gate";
import { WebAnalyticsServiceError, type WebAnalyticsService } from "./web-analytics-service";

const privateHeaders = { "cache-control": "private, no-store", vary: "Authorization" };
const failure = (status: number, code: string) => Response.json({ error: { code } }, { status, headers: privateHeaders });

export function createGetWebAnalyticsHandler(dependencies: {
  authorize(input: { authorization: string; correlationId: string }): Promise<AdminSession>;
  analytics: WebAnalyticsService;
  now?: () => Date;
}) {
  return async (request: Request) => {
    try {
      await dependencies.authorize({
        authorization: request.headers.get("authorization") ?? "",
        correlationId: crypto.randomUUID(),
      });

      const params = new URL(request.url).searchParams;
      if ([...params.keys()].some((key) => key !== "days" || params.getAll(key).length !== 1)) {
        return failure(400, "INVALID_QUERY");
      }
      const daysInput = params.get("days") ?? "7";
      if (!/^(7|30|90)$/.test(daysInput)) return failure(400, "INVALID_QUERY");
      const parsedDays = webAnalyticsDaysSchema.safeParse(Number(daysInput));
      if (!parsedDays.success) return failure(400, "INVALID_QUERY");

      const data = await dependencies.analytics.read({
        days: parsedDays.data,
        now: dependencies.now?.() ?? new Date(),
      });
      return Response.json(data, { status: 200, headers: privateHeaders });
    } catch (error) {
      if (error instanceof AuthError) {
        return failure(error.status, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
      }
      if (error instanceof WebAnalyticsServiceError) {
        return failure(503, error.code);
      }
      return failure(503, "WEB_ANALYTICS_UNAVAILABLE");
    }
  };
}
