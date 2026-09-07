import { createInstagramDependencies } from "../../../../../server/instagram/dependencies";
import { constantTimeEqual } from "../../../../../server/instagram/crypto";
import { privateHeaders } from "../../../../../server/instagram/pages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32 || !constantTimeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401, headers: privateHeaders });
  }
  try {
    const enabled = process.env.INSTAGRAM_INTEGRATION_ENABLED === "true";
    if (!enabled && !process.env.INSTAGRAM_APP_ID) return Response.json({ skipped: "not_configured" }, { headers: privateHeaders });
    const deps = createInstagramDependencies({ allowDisabled: true });
    await deps.repository.cleanup();
    if (!enabled) return Response.json({ skipped: "collection_disabled" }, { headers: privateHeaders });
    return Response.json({ results: await deps.service.sync() }, { headers: privateHeaders });
  } catch {
    return Response.json({ error: { code: "INSTAGRAM_SYNC_UNAVAILABLE" } }, { status: 503, headers: privateHeaders });
  }
}
