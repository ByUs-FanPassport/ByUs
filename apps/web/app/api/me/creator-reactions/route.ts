import { createCreatorReactionBatchRouteDependencies } from "../../../../server/reaction/creator-reaction-batch-route-dependencies";
import { createGetCreatorReactionsHandler } from "../../../../server/reaction/creator-reaction-batch-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    return createGetCreatorReactionsHandler(createCreatorReactionBatchRouteDependencies())(request);
  } catch {
    return Response.json({ error: { code: "REACTION_UNAVAILABLE" } }, { status: 503, headers: { "cache-control": "private, no-store", vary: "Authorization" } });
  }
}
