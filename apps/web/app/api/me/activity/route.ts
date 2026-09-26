import { createFanpageDependencies } from "@/server/fanpage/dependencies";
import { createFanHistoryHandler } from "@/server/my/fan-history-route";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return await createFanHistoryHandler(createFanpageDependencies())(request); }
  catch { return Response.json({ error: { code: "HISTORY_UNAVAILABLE" } }, { status: 503, headers: { "cache-control": "private, no-store", vary: "Authorization" } }); }
}
