import { createAnalyticsRouteDependencies } from "../../../../../server/g5/analytics-route-dependencies";
import { createGetCreatorAnalyticsHandler } from "../../../../../server/g5/analytics-route";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return createGetCreatorAnalyticsHandler(createAnalyticsRouteDependencies())(request); }
