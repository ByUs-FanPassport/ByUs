import { notFound } from "next/navigation";
import { CelebrityFanPage } from "../../../components/celebrity-fan-page";
import { createPublishedContentRepositoryFromEnvironment } from "../../../server/content/published-content-repository";

export const dynamic = "force-dynamic";

export default async function CelebrityPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ locale?: string }> }) {
  const { slug } = await params;
  const { locale: requestedLocale } = await searchParams;
  const locale = requestedLocale === "en" ? "en" : "ko";
  const repository = createPublishedContentRepositoryFromEnvironment();
  const [celebrity, primaryLives] = await Promise.all([
    repository.findBySlug(locale, slug),
    repository.listPrimaryLives(locale),
  ]);
  if (!celebrity) notFound();
  const upcomingLive = primaryLives.find((live) => live.celebritySlug === slug) ?? null;
  return <CelebrityFanPage celebrity={celebrity} locale={locale} upcomingLive={upcomingLive} />;
}
