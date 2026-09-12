import "server-only";

import {
  OBSERVED_LIVE_MAX_AGE_MS,
  type ObservedLiveCard,
  type ObservedLiveFeed,
  type ObservedLiveTarget,
} from "../../features/live/domain/observed-live";
import {
  instagramLiveObservationSchema,
  INSTAGRAM_LIVE_MAX_AGE_MS,
  parseCanonicalInstagramProfileUrl,
  parseInstagramLivePermalink,
  type InstagramLiveObservation,
} from "../../features/live/domain/instagram-live";
import { parseYouTubeChannelUrl, YOUTUBE_LIVE_MAX_AGE_MS } from "../../features/live/domain/youtube-channel";
import type { InstagramLiveDiscoveryObserver } from "../instagram/cached-live-source";
import type { YouTubeLiveObserver } from "../youtube/youtube-live-source";
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

type InstagramTarget = Readonly<{
  celebrity: PublishedCelebrity;
  username: string | null;
}>;

async function observeWithConcurrency(
  handles: readonly string[],
  observer: TikTokLiveObserver,
): Promise<Map<string, TikTokLiveObservation | null>> {
  const results = new Map<string, TikTokLiveObservation | null>();
  let nextIndex = 0;
  const deadline = Date.now() + 8500;
  async function worker(): Promise<void> {
    while (nextIndex < handles.length && Date.now() < deadline) {
      const handle = handles[nextIndex++];
      if (handle === undefined) return;
      try {
        results.set(handle, await boundedObservation(() => observer(handle), Math.max(1, deadline - Date.now())));
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

async function observeInstagramWithConcurrency(
  targets: readonly InstagramTarget[],
  observer: InstagramLiveDiscoveryObserver,
): Promise<Map<string, InstagramLiveObservation | null>> {
  const uniqueJobs = new Map<string, { slug: string; username: string }>();
  for (const { celebrity, username } of targets) {
    if (username !== null) uniqueJobs.set(JSON.stringify([celebrity.slug, username]), { slug: celebrity.slug, username });
  }
  const jobs = [...uniqueJobs];
  const results = new Map<string, InstagramLiveObservation | null>();
  let nextIndex = 0;
  const deadline = Date.now() + 8500;
  async function worker(): Promise<void> {
    while (nextIndex < jobs.length && Date.now() < deadline) {
      const job = jobs[nextIndex++];
      if (!job) return;
      const [key, input] = job;
      try {
        results.set(key, await boundedObservation(() => observer(input.slug, input.username), Math.max(1, deadline - Date.now())));
      } catch {
        results.set(key, null);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, () => worker()));
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
  youtubeObserver?: YouTubeLiveObserver,
  instagramObserver?: InstagramLiveDiscoveryObserver,
): Promise<ObservedLiveFeed> {
  const targets = celebrities
    .map(targetFor)
    .filter((target): target is Target => target !== null);
  const handles = [...new Set(
    targets.flatMap(({ handle }) => (handle === null ? [] : [handle])),
  )];
  // Providers run independently: a slow YouTube request cannot consume TikTok's budget.
  const youtubeTargets = youtubeObserver ? celebrities.flatMap((celebrity) => {
    const links = celebrity.socialLinks.filter((link) => link.platform === "youtube");
    if (!links.length) return [];
    const target = links.map((link) => parseYouTubeChannelUrl(link.url)).find((value) => value !== null) ?? null;
    return [{ celebrity, target }];
  }) : [];
  const youtubeJobs = new Map<string, ReturnType<YouTubeLiveObserver>>();
  for (const { target } of youtubeTargets) {
    if (target && youtubeObserver) {
      const key = JSON.stringify(target);
      if (!youtubeJobs.has(key)) youtubeJobs.set(key, boundedObservation(() => youtubeObserver(target)));
    }
  }
  const instagramTargets = instagramObserver ? celebrities.flatMap((celebrity) => {
    const links = celebrity.socialLinks.filter((link) => link.platform === "instagram");
    if (!links.length) return [];
    const username = links.map((link) => parseCanonicalInstagramProfileUrl(link.url)).find((value) => value !== null) ?? null;
    return [{ celebrity, username }];
  }) : [];
  const [observations, youtubeResults, instagramObservations] = await Promise.all([
    observeWithConcurrency(handles, observer),
    Promise.all([...youtubeJobs].map(async ([key, job]) => [key, await job.catch(() => null)] as const)),
    instagramObserver ? observeInstagramWithConcurrency(instagramTargets, instagramObserver) : new Map<string, InstagramLiveObservation | null>(),
  ]);
  const youtubeObservations = new Map(youtubeResults);
  const checkedAt = now();
  const checkedAtMs = checkedAt.getTime();
  const items: ObservedLiveCard[] = [];
  const statuses: ObservedLiveTarget[] = [];
  const coverage = { live: 0, offline: 0, unavailable: 0, stale: 0 };

  for (const { celebrity, handle } of targets) {
    const status: ObservedLiveTarget = { celebritySlug: celebrity.slug, platform: "tiktok", handle: handle ?? "", state: "unavailable", observedAt: null };
    statuses.push(status);
    if (handle === null) {
      coverage.unavailable += 1;
      continue;
    }
    const observation = observations.get(handle) ?? null;
    if (observation === null) {
      coverage.unavailable += 1;
      continue;
    }
    status.observedAt = observation.observedAt;
    const observedAtMs = Date.parse(observation.observedAt);
    if (
      !Number.isFinite(observedAtMs) ||
      observedAtMs > checkedAtMs ||
      checkedAtMs - observedAtMs >= OBSERVED_LIVE_MAX_AGE_MS
    ) {
      status.state = "stale";
      coverage.stale += 1;
      continue;
    }
    if (observation.state === "offline") {
      status.state = "offline";
      coverage.offline += 1;
      continue;
    }
    if (observation.state === "unavailable") {
      coverage.unavailable += 1;
      continue;
    }

    status.state = "live";
    coverage.live += 1;
    items.push({
      platform: "tiktok",
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

  for (const { celebrity, target } of youtubeTargets) {
    const observation = target ? youtubeObservations.get(JSON.stringify(target)) : null;
    const status: ObservedLiveTarget = { celebritySlug: celebrity.slug, platform: "youtube", handle: target ? `${target.kind}:${target.value}` : "", state: "unavailable", observedAt: observation?.observedAt ?? null };
    statuses.push(status);
    const at = Date.parse(status.observedAt ?? "");
    if (!observation || observation.state === "unavailable") status.state = "unavailable";
    else if (!Number.isFinite(at) || at > checkedAtMs || checkedAtMs - at >= YOUTUBE_LIVE_MAX_AGE_MS) status.state = "stale";
    else if (observation.state === "offline") status.state = "offline";
    else if (observation.videoId && /^[A-Za-z0-9_-]{11}$/.test(observation.videoId) && observation.channelId && (target?.kind !== "id" || target.value === observation.channelId)) {
      status.state = "live";
      items.push({
        platform: "youtube", celebritySlug: celebrity.slug, creatorName: celebrity.name, handle: status.handle,
        title: observation.title || (locale === "ko" ? `${celebrity.name}의 YouTube LIVE` : `${celebrity.name}'s YouTube LIVE`),
        thumbnailUrl: observation.thumbnailUrl ?? celebrity.image.url, fallbackThumbnailUrl: celebrity.image.url,
        watchUrl: `https://www.youtube.com/watch?v=${observation.videoId}`,
        observedAt: observation.observedAt, expiresAt: new Date(at + YOUTUBE_LIVE_MAX_AGE_MS).toISOString(),
      });
    }
    coverage[status.state] += 1;
  }

  for (const { celebrity, username } of instagramTargets) {
    const key = username === null ? null : JSON.stringify([celebrity.slug, username]);
    const rawObservation = key === null ? null : instagramObservations.get(key) ?? null;
    const parsed = instagramLiveObservationSchema.safeParse(rawObservation);
    const observation = parsed.success ? parsed.data : null;
    const status: ObservedLiveTarget = {
      celebritySlug: celebrity.slug,
      platform: "instagram",
      handle: username ?? "",
      state: "unavailable",
      observedAt: observation?.observedAt ?? null,
    };
    statuses.push(status);
    const at = Date.parse(status.observedAt ?? "");
    if (!observation || observation.state === "unavailable") status.state = "unavailable";
    else if (!Number.isFinite(at) || at > checkedAtMs || checkedAtMs - at >= INSTAGRAM_LIVE_MAX_AGE_MS) status.state = "stale";
    else if (observation.state === "offline") status.state = "offline";
    else {
      const permalink = username === null ? null : parseInstagramLivePermalink(observation.permalink, username);
      if (username !== null && observation.username === username && permalink === observation.permalink) {
        status.state = "live";
        items.push({
          platform: "instagram",
          celebritySlug: celebrity.slug,
          creatorName: celebrity.name,
          handle: username,
          title: locale === "ko" ? `${celebrity.name}의 Instagram LIVE` : `${celebrity.name}'s Instagram LIVE`,
          thumbnailUrl: celebrity.image.url,
          fallbackThumbnailUrl: celebrity.image.url,
          watchUrl: permalink,
          observedAt: observation.observedAt,
          expiresAt: new Date(at + INSTAGRAM_LIVE_MAX_AGE_MS).toISOString(),
        });
      }
    }
    coverage[status.state] += 1;
  }
  return { items, targets: statuses, checkedAt: checkedAt.toISOString(), coverage };
}

async function boundedObservation<T extends { state: string; observedAt: string }>(observe: () => Promise<T>, timeoutMs = 8500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([observe(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("LIVE observation timed out")), timeoutMs); })]);
  } finally { clearTimeout(timer); }
}
