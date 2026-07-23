import { LiveCatalogScreen } from "@/features/live/ui/live-catalog-screen";
import { loadServerEnv } from "@/server/config/env";
import { createLiveEventRepositoryFromEnvironment } from "@/server/g3/live-event-repository";

export const dynamic = "force-dynamic";

export default async function LivePage({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string }>;
}) {
  const requested = (await searchParams).locale;
  const locale = requested === "en" ? "en" : "ko";
  const environment = loadServerEnv();
  const repository = createLiveEventRepositoryFromEnvironment({
    url: environment.SUPABASE_URL,
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
  });
  const catalog = await repository.listPublishedCatalog({
    locale,
    appUserId: null,
    now: new Date(),
  });
  return <LiveCatalogScreen initialCatalog={catalog} locale={locale} />;
}
