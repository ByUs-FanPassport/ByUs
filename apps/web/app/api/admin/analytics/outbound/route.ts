import { createG6AnalyticsRouteDependencies } from "@/server/g6/analytics-route-dependencies";
import { loadServerEnv } from "@/server/config/env";
import { createOutboundAnalyticsRepository } from "@/server/admin/outbound-analytics-repository";
import { createGetOutboundAnalyticsHandler } from "@/server/admin/outbound-analytics-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { authorize } = createG6AnalyticsRouteDependencies();
  const environment = loadServerEnv();
  const repository = createOutboundAnalyticsRepository({ url: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY });
  return createGetOutboundAnalyticsHandler({ authorize, repository })(request);
}
