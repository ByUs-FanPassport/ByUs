import { publicMetadata, pageCopy } from "@/seo/metadata";
import { CelebrityDirectory } from "../../components/celebrity-directory";
import { parseCreatorRoleFilter } from "../../features/creator/domain/creator-role";
import { createPublishedContentRepositoryFromEnvironment } from "../../server/content/published-content-repository";

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ locale?: string | string[] }> }) {
  const locale = (await searchParams).locale === "en" ? "en" : "ko";
  return publicMetadata({ path: "/celebrities", locale, ...pageCopy.celebrities[locale] });
}

export default async function CelebritiesPage({ searchParams }: { searchParams: Promise<{ locale?: string | string[]; owned?: string | string[]; q?: string | string[]; sort?: string | string[]; role?: string | string[] }> }) {
  const { locale: requestedLocale, owned, q, sort, role } = await searchParams;
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
  const initialOwnedOnly = owned === "1" ? true : owned !== undefined || role !== undefined || q !== undefined || sort !== undefined ? false : undefined;
  return <CelebrityDirectory celebrities={celebrities} locale={locale} initialRole={initialOwnedOnly ? "all" : parseCreatorRoleFilter(role)} initialOwnedOnly={initialOwnedOnly} initialQuery={typeof q === "string" ? q : q?.[0] ?? ""} initialSort={sort === "name-asc" || sort === "live-first" ? sort : "published"} />;
}
