import { createFanpageDependencies } from "@/server/fanpage/dependencies";
import { createGetFanTicketsHandler } from "@/server/tickets/fan-ticket-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return createGetFanTicketsHandler(createFanpageDependencies())(request);
}
