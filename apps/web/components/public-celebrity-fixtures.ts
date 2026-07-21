export type PublishedCelebrity = Readonly<{
  slug: string;
  name: string;
  image: string;
  imageAlt: string;
  imagePosition: string;
  summary: string;
  upcomingLive: Readonly<{
    slug: string;
    title: string;
    schedule: string;
  }> | null;
}>;

/**
 * Read-only G1 fixture repository.
 * Replace this boundary with the anonymous published-celebrity DTO; never expose draft CMS rows.
 */
export const publishedCelebrityFixtures: readonly PublishedCelebrity[] = Object.freeze([
  Object.freeze({
    slug: "kara",
    name: "KARA",
    image: "/images/guest-home/kara-card.jpg",
    imageAlt: "파란색 무대 의상을 입은 KARA 멤버들",
    imagePosition: "center 46%",
    summary: "KARA와 함께할 다음 LIVE를 확인하고 Fan Passport 여정을 시작해 보세요.",
    upcomingLive: Object.freeze({ slug: "kara-nualeaf", title: "KARA × NUALEAF LIVE", schedule: "7월 24일 오후 8:00" }),
  }),
  Object.freeze({
    slug: "elina",
    name: "Elina",
    image: "/images/guest-home/elina-card.jpg",
    imageAlt: "따뜻한 조명 아래 Elina 프로필",
    imagePosition: "center 36%",
    summary: "Elina의 공개 LIVE 소식과 앞으로 기록할 팬 활동을 만나보세요.",
    upcomingLive: Object.freeze({ slug: "elina-beauty-talk", title: "BEAUTY TALK LIVE", schedule: "7월 27일 오후 8:00" }),
  }),
  Object.freeze({
    slug: "changha",
    name: "Changha",
    image: "/images/guest-home/changha-card.jpg",
    imageAlt: "어두운 배경의 Changha 프로필",
    imagePosition: "center 32%",
    summary: "Changha의 공식 팬 활동이 열리면 이곳에서 가장 먼저 확인할 수 있어요.",
    upcomingLive: null,
  }),
]);

export function findPublishedCelebrity(slug: string): PublishedCelebrity | undefined {
  return publishedCelebrityFixtures.find((celebrity) => celebrity.slug === slug);
}
