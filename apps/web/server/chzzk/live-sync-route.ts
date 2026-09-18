import "server-only";
import { constantTimeEqual } from "../instagram/crypto";
const headers = { "cache-control": "no-store" };
export function createGetChzzkLiveSyncHandler(deps: { secret?: string; enabled: boolean; run: () => Promise<unknown> }) {
  return async (request: Request) => {
    if (!deps.secret || deps.secret.length < 32 || !constantTimeEqual(request.headers.get("authorization") ?? "", `Bearer ${deps.secret}`)) return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401, headers });
    if (!deps.enabled) return Response.json({ skipped: "collection_disabled" }, { headers });
    try { return Response.json({ result: await deps.run() }, { headers }); }
    catch { return Response.json({ error: { code: "CHZZK_LIVE_SYNC_UNAVAILABLE" } }, { status: 503, headers }); }
  };
}
