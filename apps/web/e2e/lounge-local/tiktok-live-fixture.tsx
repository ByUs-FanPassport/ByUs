import type { AppLocale } from "../../i18n/locales";
import type { ObservedLiveCard } from "../../features/live/domain/observed-live";
import { TikTokLivePlayer } from "../../features/live/ui/tiktok-live-player";

const creatorSlug = "park-myungho";

export const tiktokLiveFixtureItem: ObservedLiveCard = {
  platform: "tiktok",
  celebritySlug: creatorSlug,
  creatorName: "박명호",
  handle: "myunghopark74",
  title: "330회 방송 · 댓글 인사와 함께하는 LIVE",
  thumbnailUrl: "/images/celebrities/park-myungho/profile-20260910.png",
  fallbackThumbnailUrl: "/images/celebrities/park-myungho/profile-20260910.png",
  watchUrl: "https://www.tiktok.com/@myunghopark74/live",
  observedAt: "2026-09-27T00:00:00.000Z",
  expiresAt: "2099-09-27T00:01:30.000Z",
  playbackAvailable: true,
};

export function TikTokLiveFallbackFixture({ locale }: { locale: AppLocale }) {
  return <TikTokLivePlayer item={tiktokLiveFixtureItem} locale={locale} onClose={() => {}} />;
}

export function tiktokPlaybackFixtureResponse(url: string, method: string, state: string | null): Response | null {
  const requestUrl = new URL(url, "http://localhost");
  if (method !== "GET" || requestUrl.pathname !== `/api/public/live-now/${creatorSlug}/playback`) return null;
  if (state === "ended") return Response.json({ error: "ended" }, { status: 410 });
  if (state === "restricted") return Response.json({ error: "restricted" }, { status: 403 });
  return Response.json({ error: "unavailable" }, { status: 503 });
}
