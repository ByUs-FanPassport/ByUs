import { parseAppLocale } from "@/i18n/locales";
import { FanAppFrame, FanContentContainer } from "@/components/fan-shell/fan-app-shell";
import { NoticeDetail } from "@/components/notice/notice-detail";
import { fanPageBrandCopy } from "@/i18n/catalogs/features__fanpage__brand";
import { loadSeoCreator } from "@/server/seo/public-content";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function NoticeDetailPage({ params, searchParams }: {
  params: Promise<{ slug: string; noticeSlug: string }>;
  searchParams: Promise<{ locale?: string }>;
}) {
  const { slug, noticeSlug } = await params;
  const locale = parseAppLocale((await searchParams).locale);
  const celebrity = await loadSeoCreator(slug, locale);
  if (!celebrity) notFound();
  const officialPostLabel = celebrity.roles.includes("brand") ? fanPageBrandCopy[locale].officialPost : undefined;
  return <FanAppFrame locale={locale} mainId="notice-detail-main"><FanContentContainer as="main" id="notice-detail-main" tabIndex={-1}>
    <NoticeDetail slug={slug} noticeSlug={noticeSlug} locale={locale} officialPostLabel={officialPostLabel} />
  </FanContentContainer></FanAppFrame>;
}
