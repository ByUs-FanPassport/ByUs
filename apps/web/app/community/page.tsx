import { notFound } from "next/navigation";
import { parseAppLocale, toContentLocale } from "@/i18n/locales";
import { communityCopy } from "@/i18n/catalogs/features__community";
import { publicMetadata } from "@/seo/metadata";
import { createPublishedContentRepositoryFromEnvironment } from "@/server/content/published-content-repository";
import { parseCommunityTab, selectCommunityCreator } from "@/features/community/domain/navigation";
import { CommunityScreen } from "@/features/community/ui/community-screen";

export const dynamic = "force-dynamic";
type Query = { locale?: string; creator?: string | string[]; tab?: string };

export async function generateMetadata({ searchParams }: { searchParams: Promise<Query> }) {
  const locale = parseAppLocale((await searchParams).locale), copy = communityCopy(locale);
  return publicMetadata({ path: "/community", locale, title: `${copy.title} | ByUs`, description: copy.intro });
}

export default async function CommunityPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams, locale = parseAppLocale(query.locale);
  if (Array.isArray(query.creator)) notFound();
  const creators = await createPublishedContentRepositoryFromEnvironment().list(toContentLocale(locale));
  const creator = selectCommunityCreator(creators, query.creator);
  if (query.creator !== undefined && !creator) notFound();
  return <CommunityScreen key={`${creator?.slug}:${locale}:${query.tab}`} creators={creators} creator={creator} locale={locale} tab={parseCommunityTab(query.tab)} />;
}
