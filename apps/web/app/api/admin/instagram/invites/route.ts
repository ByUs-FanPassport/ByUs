import { createInstagramDependencies } from "../../../../../server/instagram/dependencies";
import { createInstagramInviteHandler } from "../../../../../server/instagram/routes";
import { privateHeaders } from "../../../../../server/instagram/pages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try { return await createInstagramInviteHandler(createInstagramDependencies())(request); }
  catch { return Response.json({ error: { code: "INSTAGRAM_UNAVAILABLE" } }, { status: 503, headers: privateHeaders }); }
}
