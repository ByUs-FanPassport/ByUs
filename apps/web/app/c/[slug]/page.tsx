import { notFound } from "next/navigation";
import { CelebrityFanPage, type CelebrityFanTab } from "../../../components/celebrity-fan-page";
import { createPublishedContentRepositoryFromEnvironment } from "../../../server/content/published-content-repository";

export const dynamic = "force-dynamic";

export default async function CelebrityPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ locale?: string; tab?: string }> }) {
  const { slug } = await params;
  const { locale: requestedLocale, tab: requestedTab } = await searchParams;
  const locale = requestedLocale === "en" ? "en" : "ko";
  const initialTab: CelebrityFanTab = requestedTab === "notice" || requestedTab === "live" || requestedTab === "benefits" ? requestedTab : "home";
  const repository = createPublishedContentRepositoryFromEnvironment();
  const [celebrity, primaryLives] = await Promise.all([
    repository.findBySlug(locale, slug),
    repository.listPrimaryLives(locale),
  ]);
  if (!celebrity) notFound();
  const upcomingLive = primaryLives.find((live) => live.celebritySlug === slug) ?? null;
  return <CelebrityFanPage celebrity={celebrity} locale={locale} upcomingLive={upcomingLive} initialTab={initialTab} />;
}
