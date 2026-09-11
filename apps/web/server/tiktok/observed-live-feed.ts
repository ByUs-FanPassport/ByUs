import "server-only";

import {
  OBSERVED_LIVE_MAX_AGE_MS,
  type ObservedLiveCard,
  type ObservedLiveFeed,
} from "../../features/live/domain/observed-live";
import type {
  ContentLocale,
  PublishedCelebrity,
} from "../content/content-domain";
import {
  parseCanonicalTikTokProfileUrl,
  type TikTokLiveObservation,
  type TikTokLiveObserver,
} from "./tiktok-live-source";

type Target = Readonly<{
  celebrity: PublishedCelebrity;
  handle: string | null;
}>;

async function observeWithConcurrency(
  handles: readonly string[],
  observer: TikTokLiveObserver,
): Promise<Map<string, TikTokLiveObservation | null>> {
  const results = new Map<string, TikTokLiveObservation | null>();
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < handles.length) {
      const handle = handles[nextIndex++];
      if (handle === undefined) return;
      try {
        results.set(handle, await observer(handle));
      } catch {
        results.set(handle, null);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(3, handles.length) }, () => worker()),
  );
  return results;
}

function targetFor(celebrity: PublishedCelebrity): Target | null {
  const tiktokLinks = celebrity.socialLinks.filter(
    ({ platform }) => platform === "tiktok",
  );
  if (tiktokLinks.length === 0) return null;
  const handle = tiktokLinks
    .map(({ url }) => parseCanonicalTikTokProfileUrl(url))
    .find((candidate): candidate is string => candidate !== null);
  return { celebrity, handle: handle ?? null };
}

function fallbackTitle(
  creatorName: string,
  locale: ContentLocale,
): string {
  return locale === "ko"
    ? `${creatorName}의 TikTok LIVE`
    : `${creatorName}'s TikTok LIVE`;
}

export async function buildObservedLiveFeed(
  celebrities: readonly PublishedCelebrity[],
  locale: ContentLocale,
  observer: TikTokLiveObserver,
  now: () => Date,
): Promise<ObservedLiveFeed> {
  const targets = celebrities
    .map(targetFor)
    .filter((target): target is Target => target !== null);
  const handles = [...new Set(
    targets.flatMap(({ handle }) => (handle === null ? [] : [handle])),
  )];
  const observations = await observeWithConcurrency(handles, observer);
  const checkedAt = now();
  const checkedAtMs = checkedAt.getTime();
  const items: ObservedLiveCard[] = [];
  const coverage = { live: 0, offline: 0, unavailable: 0, stale: 0 };

  for (const { celebrity, handle } of targets) {
    if (handle === null) {
      coverage.unavailable += 1;
      continue;
    }
    const observation = observations.get(handle) ?? null;
    if (observation === null) {
      coverage.unavailable += 1;
      continue;
    }
    const observedAtMs = Date.parse(observation.observedAt);
    if (
      !Number.isFinite(observedAtMs) ||
      observedAtMs > checkedAtMs ||
      checkedAtMs - observedAtMs >= OBSERVED_LIVE_MAX_AGE_MS
    ) {
      coverage.stale += 1;
      continue;
    }
    if (observation.state === "offline") {
      coverage.offline += 1;
      continue;
    }
    if (observation.state === "unavailable") {
      coverage.unavailable += 1;
      continue;
    }

    coverage.live += 1;
    items.push({
      celebritySlug: celebrity.slug,
      creatorName: celebrity.name,
      handle,
      title: observation.title || fallbackTitle(celebrity.name, locale),
      thumbnailUrl: observation.thumbnailUrl ?? celebrity.image.url,
      fallbackThumbnailUrl: celebrity.image.url,
      watchUrl: `https://www.tiktok.com/@${handle}/live`,
      observedAt: observation.observedAt,
      expiresAt: new Date(observedAtMs + OBSERVED_LIVE_MAX_AGE_MS).toISOString(),
    });
  }

  return { items, checkedAt: checkedAt.toISOString(), coverage };
}
