import { createG6AnalyticsRouteDependencies } from "../../../../../server/g6/analytics-route-dependencies";
import { createGetPlatformAnalyticsHandler } from "../../../../../server/g6/platform-analytics-route";
export const dynamic="force-dynamic";
export async function GET(request:Request){const dependencies=createG6AnalyticsRouteDependencies();return createGetPlatformAnalyticsHandler({authorize:dependencies.authorize,repository:dependencies.platformRepository})(request)}

