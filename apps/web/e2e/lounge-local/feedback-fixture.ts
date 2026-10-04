import type { AppLocale } from "../../i18n/locales";
import { toContentLocale } from "../../i18n/locales";
import type { HomeBanner } from "../../features/home/domain/home-banner";
import type { PublishedCelebrity } from "../../server/content/content-domain";

const localizedName = (locale: AppLocale, ko: string, en: string) => locale === "ko" ? ko : en;
const creator = (locale: AppLocale, input: Pick<PublishedCelebrity, "slug" | "roles"> & { ko: string; en: string; image: string; order: number }): PublishedCelebrity => ({
  slug: input.slug,
  locale: toContentLocale(locale),
  name: localizedName(locale, input.ko, input.en),
  summary: localizedName(locale, `${input.ko} 팬페이지`, `${input.en} fan page`),
  image: { url: input.image, alt: localizedName(locale, `${input.ko} 프로필`, `${input.en} portrait`), position: "50% 28%" },
  roles: input.roles,
  themes: [],
  socialLinks: input.slug === "elina" ? [
    { platform: "youtube", url: "https://www.youtube.com/@ElinaKarimova" },
    { platform: "instagram", url: "https://www.instagram.com/elina_4_22/" },
    { platform: "tiktok", url: "https://www.tiktok.com/@elina_4_22" },
  ] : [],
  displayOrder: input.order,
  fanCount: 1200 - input.order * 100,
});

export function feedbackPublishedCreators(locale: AppLocale): PublishedCelebrity[] {
  return [
    creator(locale, { slug: "elina", ko: "엘리나", en: "Elina", image: "/images/guest-home/elina-card.jpg", roles: ["creator"], order: 0 }),
    creator(locale, { slug: "jenny-jeong", ko: "제니정", en: "Jenny Jeong", image: "/images/celebrities/jenny-jeong/hero-editorial-portrait-20260911.webp", roles: ["creator"], order: 1 }),
    creator(locale, { slug: "katseye", ko: "캣츠아이", en: "KATSEYE", image: "/images/celebrities/katseye/card.webp", roles: ["idol"], order: 2 }),
  ];
}

export const feedbackUnpublishedCreatorRecord = {
  slug: "kara",
  status: "draft",
  image: "/images/guest-home/kara-card.jpg",
} as const;

export function feedbackBanner(locale: AppLocale): HomeBanner {
  return {
    id: "90000000-0000-4000-8000-000000000001",
    kind: "regular_live",
    celebrityId: "c7200000-0000-4000-8000-000000000001",
    title: localizedName(locale, "엘리나의 다음 LIVE", "Elina’s next LIVE"),
    description: localizedName(locale, "팬과 함께하는 새로운 순간을 만나보세요.", "Join the next moment with fans."),
    ctaLabel: localizedName(locale, "LIVE 일정 보기", "View LIVE schedule"),
    href: "/live?creator=elina",
    alt: localizedName(locale, "엘리나 LIVE 안내", "Elina LIVE announcement"),
    desktopImage: { id: "90000000-0000-4000-8000-000000000003", url: "/images/celebrities/elina/hero-beach.jpg", width: 1600, height: 900, mimeType: "image/jpeg", revision: 1 },
    mobileImage: { id: "90000000-0000-4000-8000-000000000004", url: "/images/celebrities/elina/guide-blue-beret-20260912.webp", width: 720, height: 960, mimeType: "image/webp", revision: 1 },
  };
}

const ids = {
  elinaPassport: "c7640000-0000-4000-8000-000000000001",
  jennyPassport: "c7640000-0000-4000-8000-000000000011",
  karaPassport: "c7640000-0000-4000-8000-000000000012",
  live: "c7800000-0000-4000-8000-000000000001",
  stamp: "c7850000-0000-4000-8000-000000000001",
} as const;

export function feedbackSummary(locale: AppLocale) {
  const creators = feedbackPublishedCreators(locale);
  const unpublishedName = localizedName(locale, "카라", "KARA");
  const creatorSummary = (celebrity: PublishedCelebrity, passportId: string, tier: "Silver" | "Gold" | "Platinum", score: number) => ({
    celebrity: { slug: celebrity.slug, name: celebrity.name, image: celebrity.image.url, imagePosition: celebrity.image.position },
    relationship: "passport" as const,
    passport: { id: passportId, tier, score, remainingToNextTier: 12, stageProgress: null },
    ticketBalance: 3,
    firstReaction: null,
  });
  return {
    profile: { nickname: "ByUs_Fan_함께걷는팬" },
    creators: [
      creatorSummary(creators[0]!, ids.elinaPassport, "Silver", 28),
      creatorSummary(creators[1]!, ids.jennyPassport, "Gold", 74),
      creatorSummary({ ...creators[0]!, slug: "kara", name: unpublishedName, image: { url: feedbackUnpublishedCreatorRecord.image, alt: unpublishedName, position: "center" } }, ids.karaPassport, "Platinum", 130),
    ],
    live: { upcoming: [{ id: ids.live, slug: "elina-feedback-live", title: localizedName(locale, "엘리나 팬 LIVE", "Elina fan LIVE"), startsAt: "2026-10-20T11:00:00.000Z", effectiveStatus: "scheduled" as const, attended: false }], history: [] },
    rewards: { availableCount: 2, entries: 1, items: [] },
    collection: { passportCount: 3, stampCount: 7, collectibleCount: 2, recent: [{ kind: "stamp" as const, id: ids.stamp, title: localizedName(locale, "LIVE 출석 Stamp", "LIVE attendance Stamp"), occurredAt: "2026-10-02T11:00:00.000Z", href: `/passports/${ids.elinaPassport}` }] },
    unreadNotificationCount: 4,
  };
}

const mediaItems = [
  { id: "feedback-photo", kind: "photos", title: "엘리나와 함께한 가을의 순간", image: "/images/celebrities/elina/guide-autumn-20260921.jpg", asset: null, href: "/c/elina/notices/welcome-byus", date: "2026-10-03T03:00:00.000Z" },
  { id: "feedback-video", kind: "videos", title: "팬들과 다시 보는 LIVE 하이라이트", image: "/images/celebrities/elina/guide-blue-beret-20260912.webp", asset: null, href: "https://www.youtube.com/watch?v=abcdefghijk", date: "2026-10-01T03:00:00.000Z" },
] as const;

export const feedbackLeaderboardNickname = "ByUsFan_초장문닉네임테스트ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789끝까지함께해요";
const leaderboardRow = (rank: number, nickname: string, points: number, avatarUrl: string) => ({ rank, nickname, points, avatarUrl });

export function feedbackFixtureResponse(rawUrl: string, method: string, locale: AppLocale): Response | null {
  if (method !== "GET") return null;
  const url = new URL(rawUrl, location.origin);
  if (url.pathname === "/api/me/summary") return Response.json({ summary: feedbackSummary(locale) });
  if (url.pathname === "/api/me/avatar") return Response.json({ avatar: { initialCharacterId: "star-pink", characterId: "star-pink", source: "character", hasImage: false, revision: 0 } });
  if (url.pathname === "/api/community-stamps") return Response.json({ stamps: [], today: "2026-10-04" });
  if (url.pathname === "/api/me/tickets") return Response.json({ enabled: true, creator: { slug: "elina", name: localizedName(locale, "엘리나", "Elina") }, balance: 3, today: "2026-10-04", actions: [{ key: "checkin", amount: 1, status: "available", href: "/c/elina/tickets/checkin" }], history: [], nextBefore: null });
  if (url.pathname === "/api/celebrities/elina/media") return Response.json({ items: mediaItems, nextCursor: null });
  if (url.pathname === "/api/celebrities/elina/leaderboard") return Response.json({
    membershipCount: 120,
    fanCount: 120,
    available: true,
    asOf: "2026-10-04T12:00:00.000Z",
    rows: [
      leaderboardRow(1, feedbackLeaderboardNickname, 123456, "/images/avatars/star-pink.webp"),
      leaderboardRow(2, "함께걷는팬", 98210, "/images/avatars/heart-cream.webp"),
      leaderboardRow(3, "ByUsFan", 76543, "/images/avatars/fairy-lavender.webp"),
    ],
    me: leaderboardRow(1, feedbackLeaderboardNickname, 123456, "/images/avatars/star-pink.webp"),
  });
  if (url.pathname === "/api/celebrities/elina/youtube") return Response.json({ items: [], nextCursor: null });
  if (url.pathname === "/api/celebrities/elina/instagram") return Response.json({ items: [], updatedAt: null });
  if (url.pathname === "/api/live-events") return Response.json({ catalog: { replay: [] } });
  if (url.pathname === "/api/celebrities/elina/certifications") return Response.json({ certifications: [
    { id: "c7860000-0000-4000-8000-000000000001", kind: "live_mission", category: "LIVE", title: localizedName(locale, "팬 LIVE 참여 인증", "Fan LIVE participation"), description: localizedName(locale, "LIVE 종료 후 참여 기록을 확인할 수 있어요.", "Review your participation after the LIVE ends."), status: "closed", reward: { scorePoints: 5, ticketAmount: 1 }, actionHref: "/live/elina-feedback-live" },
    { id: "c7860000-0000-4000-8000-000000000002", kind: "manual", category: "Membership", title: localizedName(locale, "공식 멤버십 인증", "Official membership verification"), description: localizedName(locale, "공식 채널 멤버십을 인증해 주세요.", "Verify your official channel membership."), status: "available", reward: { scorePoints: 10, ticketAmount: 1 }, actionHref: "/c/elina/certifications/c7860000-0000-4000-8000-000000000002" },
  ] });
  if (url.pathname === "/api/me/celebrities/elina/certifications") return Response.json({ certifications: [{ id: "c7870000-0000-4000-8000-000000000001", kind: "manual", missionId: "c7860000-0000-4000-8000-000000000002", title: localizedName(locale, "공식 멤버십 인증", "Official membership verification"), status: "approved", attemptNumber: 2, rejectionReason: null, submittedAt: "2026-10-01T03:00:00.000Z", reviewedAt: "2026-10-02T03:00:00.000Z", actionHref: "/c/elina/certifications/c7860000-0000-4000-8000-000000000002" }] });
  return null;
}
