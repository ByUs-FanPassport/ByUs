import "server-only";

import { OBSERVED_LIVE_MAX_AGE_MS } from "../../features/live/domain/observed-live";
import {
  parseExternalLiveUrl,
  parseLiveLocale,
} from "../../features/live/domain/live-event";
import { isTikTokScheduledEventUrl } from "../../features/live/domain/live-watch-link";
import { parseYouTubeChannelUrl } from "../../features/live/domain/youtube-channel";
import type { YouTubeLiveObserver } from "../youtube/youtube-live-source";
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
  observeYouTube?: YouTubeLiveObserver;
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

    const youtubeChannel = live.watch.provider === "youtube" ? parseYouTubeChannelUrl(fallbackUrl) : null;
    const discoverable = (live.watch.provider === "tiktok" && isTikTokScheduledEventUrl(fallbackUrl)) || youtubeChannel;
    if (
      !discoverable ||
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

    if (youtubeChannel) {
      const channels = creator.socialLinks.filter(({ platform }) => platform === "youtube")
        .map(({ url }) => parseYouTubeChannelUrl(url));
      if (!dependencies.observeYouTube || channels.length === 0 || channels.some((channel) =>
        !channel || channel.kind !== youtubeChannel.kind || channel.value !== youtubeChannel.value)) {
        return redirect(fallbackUrl);
      }
      try {
        const observation = await dependencies.observeYouTube(youtubeChannel);
        const checkedAt = dependencies.now();
        const age = checkedAt.getTime() - Date.parse(observation.observedAt);
        const actualStart = Date.parse(observation.actualStartTime ?? "");
        if (observation.state !== "live" || !Number.isFinite(age) || age < 0 ||
            age >= OBSERVED_LIVE_MAX_AGE_MS ||
            !/^UC[A-Za-z0-9_-]{22}$/.test(observation.channelId ?? "") ||
            (youtubeChannel.kind === "id" && observation.channelId !== youtubeChannel.value) ||
            !/^[A-Za-z0-9_-]{11}$/.test(observation.videoId ?? "") ||
            !Number.isFinite(actualStart) || actualStart < Date.parse(live.startsAt) ||
            actualStart > checkedAt.getTime() ||
            !isInsideEventWindow(live.startsAt, live.endsAt, checkedAt)) return redirect(fallbackUrl);
        return redirect(`https://www.youtube.com/watch?v=${observation.videoId}`);
      } catch {
        return redirect(fallbackUrl);
      }
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
