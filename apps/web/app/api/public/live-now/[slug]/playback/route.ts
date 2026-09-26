import { NextResponse } from "next/server";
import { parseContentLocale } from "../../../../../../server/content/content-domain";
import { createPublishedContentRepositoryFromEnvironment, type PublishedContentRepository } from "../../../../../../server/content/published-content-repository";
import { fetchTikTokLiveObservation, parseCanonicalTikTokProfileUrl, type TikTokLiveObserver } from "../../../../../../server/tiktok/tiktok-live-source";

const headers = { "Cache-Control": "no-store" };
const failure = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

export function createGetTikTokPlayback(dependencies: {
  repository: Pick<PublishedContentRepository, "findBySlug">;
  observe?: TikTokLiveObserver;
  now?: () => number;
}) {
  return async (request: Request, slug: string): Promise<Response> => {
    let locale;
    try {
      locale = parseContentLocale(new URL(request.url).searchParams.get("locale") ?? "ko");
      if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(slug)) return failure("invalid_slug", 400);
    } catch { return failure("invalid_locale", 400); }
    try {
      const creator = await dependencies.repository.findBySlug(locale, slug);
      const handle = creator?.socialLinks
        .filter((link) => link.platform === "tiktok")
        .map((link) => parseCanonicalTikTokProfileUrl(link.url))
        .find((value) => value !== null);
      if (!handle) return failure("not_found", 404);
      // Playback must recheck access and URL expiry; the discovery cache may be stale.
      const observation = await (dependencies.observe ?? fetchTikTokLiveObservation)(handle);
      if (observation.state === "offline") return failure("ended", 410);
      if (observation.state !== "live") return failure("unavailable", 503);
      if (observation.playbackRestricted) return failure("restricted", 403);
      const now = (dependencies.now ?? Date.now)();
      const observedAt = Date.parse(observation.observedAt);
      if (!observation.playback || !Number.isFinite(observedAt) || observedAt > now || now - observedAt > 60_000
        || Date.parse(observation.playback.expiresAt) <= now + 5_000) return failure("unavailable", 503);
      return NextResponse.json({ ...observation.playback, observedAt: observation.observedAt }, { headers });
    } catch { return failure("unavailable", 503); }
  };
}

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  try {
    const { slug } = await context.params;
    return await createGetTikTokPlayback({ repository: createPublishedContentRepositoryFromEnvironment() })(request, slug);
  } catch { return failure("unavailable", 503); }
}
