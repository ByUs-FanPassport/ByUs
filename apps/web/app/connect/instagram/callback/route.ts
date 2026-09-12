import { createInstagramDependencies } from "../../../../server/instagram/dependencies";
import { createInstagramCallbackHandler } from "../../../../server/instagram/routes";
import { createInstagramOwnerCallbackHandler, isOwnerInstagramState } from "../../../../server/instagram/owner-routes";
import { instagramRequestLocale, unavailablePage } from "../../../../server/instagram/pages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function handle(request: Request) {
  try {
    const dependencies = createInstagramDependencies();
    return await (isOwnerInstagramState(new URL(request.url).searchParams.get("state"))
      ? createInstagramOwnerCallbackHandler(dependencies)
      : createInstagramCallbackHandler(dependencies))(request);
  }
  catch { return unavailablePage(instagramRequestLocale(request)); }
}
export const GET = handle;
