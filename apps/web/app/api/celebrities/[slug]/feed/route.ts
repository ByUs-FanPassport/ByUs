import { createFeedDependencies } from "@/server/fan-posts/feed-dependencies";
import { createFeedHandler, feedFailure } from "@/server/fan-posts/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    return await createFeedHandler(createFeedDependencies())(request, slug);
  } catch (error) {
    return feedFailure(error);
  }
}
