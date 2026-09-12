import { describe, expect, it } from "vitest";
import {
  mergeObservedLiveFeed,
  isObservedLiveCardFresh,
  observedLiveKey,
  type ObservedLiveCard,
  type ObservedLiveFeed,
  type ObservedLiveTarget,
} from "./observed-live";

const now = Date.parse("2026-09-12T05:00:00Z");
const tiktok: ObservedLiveCard = {
  platform: "tiktok",
  celebritySlug: "same-creator",
  creatorName: "Creator",
  handle: "creator.live",
  title: "TikTok LIVE",
  thumbnailUrl: "https://cdn.example/tiktok.jpg",
  watchUrl: "https://www.tiktok.com/@creator.live/live",
  observedAt: new Date(now - 20_000).toISOString(),
  expiresAt: new Date(now + 70_000).toISOString(),
};
const youtube: ObservedLiveCard = {
  ...tiktok,
  platform: "youtube",
  title: "YouTube LIVE",
  thumbnailUrl: "https://i.ytimg.com/vi/abcDEF123_-/hqdefault.jpg",
  watchUrl: "https://www.youtube.com/watch?v=abcDEF123_-",
};
const instagram: ObservedLiveCard = {
  ...tiktok,
  platform: "instagram",
  title: "Instagram LIVE",
  thumbnailUrl: "https://cdn.example/instagram.jpg",
  watchUrl: "https://www.instagram.com/stories/creator.live/3984542264785618047",
  expiresAt: new Date(now + 280_000).toISOString(),
};
const targetFor = (item: ObservedLiveCard, state: ObservedLiveTarget["state"] = "live", observedAt: string | null = item.observedAt): ObservedLiveTarget => ({
  platform: item.platform ?? "tiktok",
  celebritySlug: item.celebritySlug,
  handle: item.handle,
  state,
  observedAt,
});
const feed = (items: ObservedLiveCard[], targets = items.map((item) => targetFor(item)), checkedAt = new Date(now).toISOString()): ObservedLiveFeed => ({
  items,
  targets,
  checkedAt,
  coverage: { live: items.length, offline: 0, unavailable: 0, stale: 0 },
});

describe("observed LIVE feed merging", () => {
  it("defaults legacy cards to TikTok while distinguishing one creator across three platforms", () => {
    const legacy = { ...tiktok, platform: undefined };
    expect(observedLiveKey(legacy)).toBe(observedLiveKey(tiktok));
    expect(observedLiveKey(youtube)).not.toBe(observedLiveKey(tiktok));
    expect(observedLiveKey(instagram)).not.toBe(observedLiveKey(youtube));
    expect(mergeObservedLiveFeed([], feed([tiktok, youtube, instagram]), now)).toEqual([tiktok, youtube, instagram]);
  });

  it("removes fresh explicit offline evidence and prunes targets absent from the roster", () => {
    const other = {
      ...tiktok,
      celebritySlug: "other",
      handle: "other.live",
      watchUrl: "https://www.tiktok.com/@other.live/live",
    };
    const endedAt = new Date(now - 1_000).toISOString();
    expect(mergeObservedLiveFeed(
      [tiktok, other],
      feed([], [targetFor(tiktok, "offline", endedAt)]),
      now,
    )).toEqual([]);
  });

  it("retains fresh prior evidence for unavailable, stale, and older offline targets", () => {
    for (const target of [
      targetFor(tiktok, "unavailable", new Date(now).toISOString()),
      targetFor(tiktok, "stale", null),
      targetFor(tiktok, "offline", new Date(Date.parse(tiktok.observedAt) - 1).toISOString()),
    ]) {
      expect(mergeObservedLiveFeed([tiktok], feed([], [target]), now)).toEqual([tiktok]);
    }
  });

  it("keeps a fresh prior card when a response is malformed or has an unsafe watch URL", () => {
    const unsafe = { ...youtube, watchUrl: "https://evil.example/watch?v=abcDEF123_-" };
    const spoofedInstagram = { ...instagram, watchUrl: "https://www.instagram.com/stories/other/3984542264785618047" };
    expect(mergeObservedLiveFeed([tiktok], { items: [] }, now)).toEqual([tiktok]);
    expect(mergeObservedLiveFeed([tiktok], feed([unsafe], [targetFor(unsafe)]), now)).toEqual([tiktok]);
    expect(mergeObservedLiveFeed([instagram], feed([spoofedInstagram], [targetFor(spoofedInstagram)]), now)).toEqual([instagram]);
  });

  it("never extends prior expiry and drops expired evidence even on failure", () => {
    const expired = {
      ...tiktok,
      observedAt: new Date(now - 90_000).toISOString(),
      expiresAt: new Date(now).toISOString(),
    };
    expect(mergeObservedLiveFeed([expired], undefined, now)).toEqual([]);
    expect(mergeObservedLiveFeed([tiktok], undefined, now)).toEqual([tiktok]);
  });
});


it("retains YouTube and Instagram unknown states through five minutes without extending TikTok or legacy expiries", () => {
  const card = { ...youtube, observedAt: new Date(now).toISOString(), expiresAt: new Date(now + 300000).toISOString() };
  const instagramCard = { ...instagram, observedAt: new Date(now).toISOString(), expiresAt: new Date(now + 300000).toISOString() };
  expect(isObservedLiveCardFresh(card, now + 299999)).toBe(true);
  expect(isObservedLiveCardFresh(card, now + 300000)).toBe(false);
  expect(isObservedLiveCardFresh({ ...card, platform: "tiktok" }, now + 120000)).toBe(false);
  expect(isObservedLiveCardFresh({ ...card, expiresAt: new Date(now + 90000).toISOString() }, now + 90000)).toBe(false);
  expect(mergeObservedLiveFeed([card], feed([], [targetFor(card, "unavailable", null)]), now + 299999)).toEqual([card]);
  expect(isObservedLiveCardFresh(instagramCard, now + 299999)).toBe(true);
  expect(isObservedLiveCardFresh(instagramCard, now + 300000)).toBe(false);
  expect(mergeObservedLiveFeed([instagramCard], feed([], [targetFor(instagramCard, "unavailable", null)]), now + 299999)).toEqual([instagramCard]);
  expect(mergeObservedLiveFeed([card], feed([], [targetFor(card, "offline", new Date(now + 240000).toISOString())]), now + 240000)).toEqual([]);
});
