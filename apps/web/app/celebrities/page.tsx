import { CelebrityDirectory } from "../../components/celebrity-directory";
import { createPublishedContentRepositoryFromEnvironment } from "../../server/content/published-content-repository";

export const dynamic = "force-dynamic";

export default async function CelebritiesPage({ searchParams }: { searchParams: Promise<{ locale?: string }> }) {
  const { locale: requestedLocale } = await searchParams;
  const locale = requestedLocale === "en" ? "en" : "ko";
  const repository = createPublishedContentRepositoryFromEnvironment();
  const [publishedCelebrities, primaryLives] = await Promise.all([
    repository.list(locale),
    repository.listPrimaryLives(locale),
  ]);
  const livesByCelebrity = new Map(primaryLives.map((live) => [live.celebritySlug, live]));
  const celebrities = publishedCelebrities.map((celebrity) => ({
    ...celebrity,
    upcomingLive: livesByCelebrity.get(celebrity.slug) ?? null,
  }));
  return <CelebrityDirectory celebrities={celebrities} locale={locale} />;
}
