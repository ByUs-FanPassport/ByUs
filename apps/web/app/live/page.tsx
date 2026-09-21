import { toContentLocale } from "@/i18n/locales";
import { parseAppLocale } from "@/i18n/locales";
import { publicMetadata, pageCopy } from "@/seo/metadata";
import { LiveCatalogScreen } from "@/features/live/ui/live-catalog-screen";
import { loadServerEnv } from "@/server/config/env";
import { createLiveEventRepositoryFromEnvironment } from "@/server/g3/live-event-repository";

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ locale?: string | string[] }> }) {
  const locale = parseAppLocale((await searchParams).locale);
  return publicMetadata({ path: "/live", locale, ...pageCopy.live[locale] });
}

export default async function LivePage({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string }>;
}) {
  const requested = (await searchParams).locale;
  const locale = parseAppLocale(requested);
  const environment = loadServerEnv();
  const repository = createLiveEventRepositoryFromEnvironment({
    url: environment.SUPABASE_URL,
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
  });
  const catalog = await repository.listPublishedCatalog({
    locale: toContentLocale(locale),
    appUserId: null,
    now: new Date(),
  });
  return <LiveCatalogScreen initialCatalog={catalog} locale={locale} />;
}
