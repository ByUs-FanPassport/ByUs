import { createG6AnalyticsRouteDependencies } from "../../../../../server/g6/analytics-route-dependencies";
import { createGetAdminOverviewHandler } from "../../../../../server/g6/admin-overview-route";
import { createAdminOverviewRepository } from "../../../../../server/g6/admin-overview-repository";
import { loadServerEnv } from "../../../../../server/config/env";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const { authorize } = createG6AnalyticsRouteDependencies();
  const env = loadServerEnv();
  return createGetAdminOverviewHandler({ authorize, repository: createAdminOverviewRepository({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }) })(request);
}
