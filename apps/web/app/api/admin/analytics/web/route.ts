import { createG6AnalyticsRouteDependencies } from "../../../../../server/g6/analytics-route-dependencies";
import { createGetWebAnalyticsHandler } from "../../../../../server/admin/web-analytics-route";
import { createWebAnalyticsServiceFromEnv } from "../../../../../server/admin/web-analytics-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { authorize } = createG6AnalyticsRouteDependencies();
  return createGetWebAnalyticsHandler({
    authorize,
    analytics: createWebAnalyticsServiceFromEnv(),
  })(request);
}
