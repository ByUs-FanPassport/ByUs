import { GuestHome } from "../components/guest-home";
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
  const [featuredLive, celebrities] = await Promise.all([
    liveRepository.findFeaturedPublished({ locale, now: new Date() }),
    celebrityRepository.list(locale),
  ]);
  return <GuestHome celebrities={celebrities} featuredLive={featuredLive} locale={locale} />;
}
