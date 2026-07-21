import { createGetAuditLogsHandler } from "../../../../server/g5/audit-log-route";
import { createAuditLogRouteDependencies } from "../../../../server/g5/audit-log-route-dependencies";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return createGetAuditLogsHandler(createAuditLogRouteDependencies())(request);
}
