import { publicMetadata, pageCopy } from "@/seo/metadata";
import { homeStructuredData, serializeStructuredData } from "@/seo/structured-data";
import { loadGuideEventPhotos } from "../server/media/guide-images";
import { GuestHome, type HomeContentErrors } from "../components/guest-home";
import { parseCreatorRoleFilter } from "../features/creator/domain/creator-role";
import { loadServerEnv } from "../server/config/env";
import { createPublishedContentRepositoryFromEnvironment } from "../server/content/published-content-repository";
import { createLiveEventRepositoryFromEnvironment } from "../server/g3/live-event-repository";

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ locale?: string | string[] }> }) {
  const locale = (await searchParams).locale === "en" ? "en" : "ko";
  return publicMetadata({ path: "/", locale, ...pageCopy.home[locale] });
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ locale?: string | string[]; owned?: string | string[]; role?: string | string[] }> }) {
  const { locale: requestedLocale, owned, role } = await searchParams;
  const locale = requestedLocale === "en" ? "en" : "ko";
  const initialOwnedOnly = owned === "1" ? true : owned !== undefined || role !== undefined ? false : undefined;
  const environment = loadServerEnv();
  const liveRepository = createLiveEventRepositoryFromEnvironment({
    url: environment.SUPABASE_URL,
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
  });
  const celebrityRepository = createPublishedContentRepositoryFromEnvironment();
  const [featuredLivesResult, celebritiesResult, celebrityLivesResult, guideEventPhotosResult] = await Promise.allSettled([
    liveRepository.listFeaturedPublished({ locale, now: new Date() }),
    celebrityRepository.list(locale),
    celebrityRepository.listPrimaryLives(locale),
    loadGuideEventPhotos(),
  ]);
  if (featuredLivesResult.status === "rejected" && celebritiesResult.status === "rejected") throw new Error("Home content unavailable");
  const contentErrors: HomeContentErrors = {
    featuredLives: featuredLivesResult.status === "rejected" || undefined,
    celebrities: celebritiesResult.status === "rejected" || undefined,
    celebrityLives: celebrityLivesResult.status === "rejected" || undefined,
    guideImages: guideEventPhotosResult.status === "rejected" || undefined,
  };
  return <>
    <script
      id="byus-home-structured-data"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeStructuredData(homeStructuredData()) }}
    />
    <GuestHome
      guideEventPhotos={guideEventPhotosResult.status === "fulfilled" ? guideEventPhotosResult.value : undefined}
      celebrities={celebritiesResult.status === "fulfilled" ? celebritiesResult.value : []}
      celebrityLives={celebrityLivesResult.status === "fulfilled" ? celebrityLivesResult.value : []}
      featuredLives={featuredLivesResult.status === "fulfilled" ? featuredLivesResult.value : []}
      locale={locale}
      contentErrors={contentErrors}
      initialOwnedOnly={initialOwnedOnly}
      initialRole={initialOwnedOnly ? "all" : parseCreatorRoleFilter(role)}
    />
  </>;
}
