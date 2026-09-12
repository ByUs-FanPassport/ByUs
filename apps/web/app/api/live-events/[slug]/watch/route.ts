import { createPublishedContentRepositoryFromEnvironment } from "../../../../../server/content/published-content-repository";
import { createLiveEventRepositoryFromEnvironment } from "../../../../../server/g3/live-event-repository";
import { createGetLiveWatchHandler } from "../../../../../server/g3/live-watch-route";
import { getCachedTikTokLiveObservation } from "../../../../../server/tiktok/cached-tiktok-live-source";

export const dynamic = "force-dynamic";

const noStoreHeaders = { "cache-control": "no-store" } as const;

function unavailable(): Response {
  return Response.json(
    { error: { code: "LIVE_UNAVAILABLE" } },
    { status: 503, headers: noStoreHeaders },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  try {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) return unavailable();
    const { slug } = await context.params;
    return createGetLiveWatchHandler({
      repository: createLiveEventRepositoryFromEnvironment({ url, serviceRoleKey }),
      creators: createPublishedContentRepositoryFromEnvironment(),
      observe: getCachedTikTokLiveObservation,
      now: () => new Date(),
    })(request, { slug });
  } catch {
    return unavailable();
  }
}
