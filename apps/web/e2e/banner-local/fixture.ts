import type { HomeBanner } from "../../features/home/domain/home-banner";
export const bannerFixture: HomeBanner = {
  id: "90000000-0000-4000-8000-000000000001", kind: "regular_live", celebrityId: "90000000-0000-4000-8000-000000000002",
  title: "엘리나의 정기 LIVE", description: "매주 금요일 오후 8시 · KST", ctaLabel: "방송 일정 보기", href: "/live/calendar?celebrity=elina", alt: "엘리나의 정기 방송",
  desktopImage: { id: "90000000-0000-4000-8000-000000000003", url: "/images/guest-home/kara-hero.png", width: 1360, height: 680, mimeType: "image/png", revision: 1 },
  mobileImage: { id: "90000000-0000-4000-8000-000000000004", url: "/images/guest-home/elina-card.jpg", width: 440, height: 550, mimeType: "image/jpeg", revision: 1 },
};
