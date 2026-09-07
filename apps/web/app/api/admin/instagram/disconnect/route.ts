import { createInstagramDependencies } from "../../../../../server/instagram/dependencies";
import { createInstagramDisconnectHandler } from "../../../../../server/instagram/routes";
import { privateHeaders } from "../../../../../server/instagram/pages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try { return await createInstagramDisconnectHandler(createInstagramDependencies({ allowDisabled: true }))(request); }
  catch { return Response.json({ error: { code: "INSTAGRAM_UNAVAILABLE" } }, { status: 503, headers: privateHeaders }); }
}
