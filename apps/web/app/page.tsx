import { GuestHome, type HomeContentErrors } from "../components/guest-home";
import { loadServerEnv } from "../server/config/env";
import { createPublishedContentRepositoryFromEnvironment } from "../server/content/published-content-repository";
import { createLiveEventRepositoryFromEnvironment } from "../server/g3/live-event-repository";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ locale?: string }> }) {
  const { locale: requestedLocale } = await searchParams;
  const locale = requestedLocale === "en" ? "en" : "ko";
  const environment = loadServerEnv();
  const liveRepository = createLiveEventRepositoryFromEnvironment({
    url: environment.SUPABASE_URL,
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
  });
  const celebrityRepository = createPublishedContentRepositoryFromEnvironment();
  const [featuredLivesResult, celebritiesResult, celebrityLivesResult] = await Promise.allSettled([
    liveRepository.listFeaturedPublished({ locale, now: new Date() }),
    celebrityRepository.list(locale),
    celebrityRepository.listPrimaryLives(locale),
  ]);
  if (featuredLivesResult.status === "rejected" && celebritiesResult.status === "rejected") throw new Error("Home content unavailable");
  const contentErrors: HomeContentErrors = {
    featuredLives: featuredLivesResult.status === "rejected" || undefined,
    celebrities: celebritiesResult.status === "rejected" || undefined,
    celebrityLives: celebrityLivesResult.status === "rejected" || undefined,
  };
  return <GuestHome
    celebrities={celebritiesResult.status === "fulfilled" ? celebritiesResult.value : []}
    celebrityLives={celebrityLivesResult.status === "fulfilled" ? celebrityLivesResult.value : []}
    featuredLives={featuredLivesResult.status === "fulfilled" ? featuredLivesResult.value : []}
    locale={locale}
    contentErrors={contentErrors}
  />;
}
