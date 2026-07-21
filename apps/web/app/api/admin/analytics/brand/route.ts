import { createAnalyticsRouteDependencies } from "../../../../../server/g5/analytics-route-dependencies";
import { createGetBrandAnalyticsHandler } from "../../../../../server/g5/analytics-route";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return createGetBrandAnalyticsHandler(createAnalyticsRouteDependencies())(request); }
