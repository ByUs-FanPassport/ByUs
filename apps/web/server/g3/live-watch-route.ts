import "server-only";

import { OBSERVED_LIVE_MAX_AGE_MS } from "../../features/live/domain/observed-live";
import {
  parseExternalLiveUrl,
  parseLiveLocale,
} from "../../features/live/domain/live-event";
import { isTikTokScheduledEventUrl } from "../../features/live/domain/live-watch-link";
import type { PublishedContentRepository } from "../content/published-content-repository";
import {
  parseCanonicalTikTokProfileUrl,
  type TikTokLiveObserver,
} from "../tiktok/tiktok-live-source";
import type { LiveEventRepository } from "./live-event-repository";

export type LiveWatchRouteDependencies = Readonly<{
  repository: Pick<LiveEventRepository, "findPublishedBySlug">;
  creators: Pick<PublishedContentRepository, "findBySlug">;
  observe: TikTokLiveObserver;
  now: () => Date;
}>;

const noStoreHeaders = { "cache-control": "no-store" } as const;

function errorResponse(code: string, status: number): Response {
  return Response.json({ error: { code } }, { status, headers: noStoreHeaders });
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 307,
    headers: { ...noStoreHeaders, location },
  });
}

function isInsideEventWindow(startsAt: string, endsAt: string, now: Date): boolean {
  const startsAtMs = Date.parse(startsAt);
  const endsAtMs = Date.parse(endsAt);
  const nowMs = now.getTime();
  return Number.isFinite(startsAtMs) && Number.isFinite(endsAtMs) &&
    startsAtMs <= nowMs && nowMs < endsAtMs;
}

export function createGetLiveWatchHandler(
  dependencies: LiveWatchRouteDependencies,
) {
  return async function GET(
    request: Request,
    input: { slug: string },
  ): Promise<Response> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) {
      return errorResponse("LIVE_NOT_FOUND", 404);
    }

    let locale;
    try {
      locale = parseLiveLocale(
        new URL(request.url).searchParams.get("locale") ?? "ko",
      );
    } catch {
      return errorResponse("INVALID_LOCALE", 400);
    }

    let result;
    try {
      result = await dependencies.repository.findPublishedBySlug({
        slug: input.slug,
        locale,
        appUserId: null,
        now: dependencies.now(),
      });
    } catch {
      return errorResponse("LIVE_UNAVAILABLE", 503);
    }
    if (!result) return errorResponse("LIVE_NOT_FOUND", 404);

    const { live } = result;
    let fallbackUrl: string;
    try {
      fallbackUrl = parseExternalLiveUrl(live.watch.provider, live.watch.url);
    } catch {
      return errorResponse("LIVE_UNAVAILABLE", 503);
    }

    if (
      live.watch.provider !== "tiktok" ||
      !isTikTokScheduledEventUrl(fallbackUrl) ||
      live.effectiveStatus !== "live" ||
      !live.watch.available ||
      !isInsideEventWindow(live.startsAt, live.endsAt, dependencies.now())
    ) {
      return redirect(fallbackUrl);
    }

    let creator;
    try {
      creator = await dependencies.creators.findBySlug(
        locale,
        live.celebrity.slug,
      );
    } catch {
      return redirect(fallbackUrl);
    }
    if (!creator || creator.slug !== live.celebrity.slug) {
      return redirect(fallbackUrl);
    }

    const tiktokLinks = creator.socialLinks.filter(
      ({ platform }) => platform === "tiktok",
    );
    const handles = tiktokLinks.map(({ url }) =>
      parseCanonicalTikTokProfileUrl(url),
    );
    if (
      handles.length === 0 ||
      handles.some((handle) => handle === null)
    ) {
      return redirect(fallbackUrl);
    }
    const distinctHandles = new Set(handles as string[]);
    if (distinctHandles.size !== 1) return redirect(fallbackUrl);
    const handle = distinctHandles.values().next().value as string;

    let observation;
    try {
      observation = await dependencies.observe(handle);
    } catch {
      return redirect(fallbackUrl);
    }

    const checkedAt = dependencies.now();
    const observedAtMs = Date.parse(observation.observedAt);
    const ageMs = checkedAt.getTime() - observedAtMs;
    if (
      observation.state !== "live" ||
      !Number.isFinite(observedAtMs) ||
      ageMs < 0 ||
      ageMs >= OBSERVED_LIVE_MAX_AGE_MS ||
      !isInsideEventWindow(live.startsAt, live.endsAt, checkedAt)
    ) {
      return redirect(fallbackUrl);
    }

    return redirect(`https://www.tiktok.com/@${handle}/live`);
  };
}
