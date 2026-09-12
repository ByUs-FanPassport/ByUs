import { NextResponse } from "next/server";

import { parseContentLocale } from "../../../../server/content/content-domain";
import {
  createPublishedContentRepositoryFromEnvironment,
  type PublishedContentRepository,
} from "../../../../server/content/published-content-repository";
import { getCachedTikTokLiveObservation } from "../../../../server/tiktok/cached-tiktok-live-source";
import { buildObservedLiveFeed } from "../../../../server/tiktok/observed-live-feed";
import type { TikTokLiveObserver } from "../../../../server/tiktok/tiktok-live-source";
import {
  getCachedInstagramLiveDiscoveryObservation,
  type InstagramLiveDiscoveryObserver,
} from "../../../../server/instagram/cached-live-source";

import { getCachedYouTubeLiveObservation } from "../../../../server/youtube/cached-youtube-live-source";
import type { YouTubeLiveObserver } from "../../../../server/youtube/youtube-live-source";

type LiveNowDependencies = Readonly<{
  repository: Pick<PublishedContentRepository, "list">;
  observe?: TikTokLiveObserver;
  now?: () => Date;
  observeYouTube?: YouTubeLiveObserver;
  observeInstagram?: InstagramLiveDiscoveryObserver;
}>;

const noStoreHeaders = { "Cache-Control": "no-store" } as const;

export function createGetObservedLiveNow(dependencies: LiveNowDependencies) {
  return async function GET(request: Request): Promise<Response> {
    let locale;
    try {
      locale = parseContentLocale(
        new URL(request.url).searchParams.get("locale") ?? "ko",
      );
    } catch {
      return NextResponse.json(
        { error: "invalid_locale" },
        { status: 400, headers: noStoreHeaders },
      );
    }

    try {
      const celebrities = await dependencies.repository.list(locale);
      const version = new URL(request.url).searchParams.get("v");
      const feed = await buildObservedLiveFeed(
        celebrities,
        locale,
        dependencies.observe ?? getCachedTikTokLiveObservation,
        dependencies.now ?? (() => new Date()),
        version === "2" || version === "3" ? dependencies.observeYouTube ?? getCachedYouTubeLiveObservation : undefined,
        version === "3" ? dependencies.observeInstagram ?? getCachedInstagramLiveDiscoveryObservation : undefined,
      );
      return NextResponse.json(feed, {
        status: 200,
        headers: noStoreHeaders,
      });
    } catch {
      return NextResponse.json(
        { error: "content_unavailable" },
        { status: 503, headers: noStoreHeaders },
      );
    }
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    return createGetObservedLiveNow({
      repository: createPublishedContentRepositoryFromEnvironment(),
    })(request);
  } catch {
    return NextResponse.json(
      { error: "content_unavailable" },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
