import { createReactionRouteDependencies } from "../../../../../server/reaction/reaction-route-dependencies";
import { createPostReactionHandler } from "../../../../../server/reaction/reaction-route";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  try {
    const { slug } = await context.params;
    return createPostReactionHandler(createReactionRouteDependencies())(request, { celebritySlug: slug });
  } catch {
    return Response.json({ error: { code: "REACTION_UNAVAILABLE" } }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
