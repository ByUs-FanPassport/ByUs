import { toContentLocale } from "@/i18n/locales";
import { parseAppLocale } from "@/i18n/locales";
import { createHomeBannerRepository } from "../server/content/home-banner-repository";
import { publicMetadata, pageCopy } from "@/seo/metadata";
import { homeStructuredData, serializeStructuredData } from "@/seo/structured-data";
import { GuestHome, type HomeContentErrors } from "../components/guest-home";
import { parseCreatorRoleFilter } from "../features/creator/domain/creator-role";
import { loadServerEnv } from "../server/config/env";
import { createPublishedContentRepositoryFromEnvironment } from "../server/content/published-content-repository";
import { createLiveEventRepositoryFromEnvironment } from "../server/g3/live-event-repository";

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ locale?: string | string[] }> }) {
  const locale = parseAppLocale((await searchParams).locale);
  return publicMetadata({ path: "/", locale, ...pageCopy.home[locale] });
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ locale?: string | string[]; owned?: string | string[]; role?: string | string[] }> }) {
  const { locale: requestedLocale, owned, role } = await searchParams;
  const locale = parseAppLocale(requestedLocale);
  const initialOwnedOnly = owned === "1" ? true : owned !== undefined || role !== undefined ? false : undefined;
  const environment = loadServerEnv();
  const liveRepository = createLiveEventRepositoryFromEnvironment({
    url: environment.SUPABASE_URL,
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
  });
  const celebrityRepository = createPublishedContentRepositoryFromEnvironment();
  const [featuredLivesResult, celebritiesResult, celebrityLivesResult, homeBannersResult] = await Promise.allSettled([
    liveRepository.listFeaturedPublished({ locale: toContentLocale(locale), now: new Date() }),
    celebrityRepository.list(toContentLocale(locale)),
    celebrityRepository.listPrimaryLives(toContentLocale(locale)),
    createHomeBannerRepository({ url: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }).list(toContentLocale(locale)),
  ]);
  if (featuredLivesResult.status === "rejected" && celebritiesResult.status === "rejected" && homeBannersResult.status === "rejected") throw new Error("Home content unavailable");
  const contentErrors: HomeContentErrors = {
    homeBanners: homeBannersResult.status === "rejected" || undefined,
    featuredLives: featuredLivesResult.status === "rejected" || undefined,
    celebrities: celebritiesResult.status === "rejected" || undefined,
    celebrityLives: celebrityLivesResult.status === "rejected" || undefined,
  };
  return <>
    <script
      id="byus-home-structured-data"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeStructuredData(homeStructuredData()) }}
    />
    <GuestHome
      homeBanners={homeBannersResult.status === "fulfilled" ? homeBannersResult.value : []}
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
