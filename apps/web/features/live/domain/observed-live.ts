export const OBSERVED_LIVE_MAX_AGE_MS = 90_000;
export const OBSERVED_LIVE_POLL_MS = 30_000;

export type ObservedLiveCard = {
  celebritySlug: string;
  creatorName: string;
  handle: string;
  title: string;
  thumbnailUrl: string;
  fallbackThumbnailUrl?: string;
  watchUrl: string;
  observedAt: string;
  expiresAt: string;
};

export type ObservedLiveFeed = {
  items: ObservedLiveCard[];
  checkedAt: string;
  coverage: {
    live: number;
    offline: number;
    unavailable: number;
    stale: number;
  };
};

export function isObservedLiveCardFresh(
  card: Pick<ObservedLiveCard, "observedAt" | "expiresAt">,
  now = Date.now(),
): boolean {
  const observedAt = Date.parse(card.observedAt);
  const expiresAt = Date.parse(card.expiresAt);
  return (
    Number.isFinite(observedAt) &&
    Number.isFinite(expiresAt) &&
    observedAt <= now &&
    now < expiresAt &&
    expiresAt - observedAt === OBSERVED_LIVE_MAX_AGE_MS
  );
}
