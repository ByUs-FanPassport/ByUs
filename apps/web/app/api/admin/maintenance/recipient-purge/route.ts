import { createGetRecipientPurgeStatusHandler } from "@/server/g6/recipient-purge-monitor-route";
import { createRecipientPurgeMonitorRouteDependencies } from "@/server/g6/recipient-purge-monitor-route-dependencies";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return createGetRecipientPurgeStatusHandler(createRecipientPurgeMonitorRouteDependencies())(request);
}
