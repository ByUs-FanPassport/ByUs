import { createBanksyAdminHandlers } from "@/server/analytics/banksy-campaign";
import { banksyRepository } from "@/server/analytics/banksy-dependencies";
import { createG6AnalyticsRouteDependencies } from "@/server/g6/analytics-route-dependencies";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return createBanksyAdminHandlers(banksyRepository(), createG6AnalyticsRouteDependencies().authorize)(request); }
export const POST = GET;
