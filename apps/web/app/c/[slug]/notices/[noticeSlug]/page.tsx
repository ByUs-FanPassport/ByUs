import { parseAppLocale } from "@/i18n/locales";
import { FanAppFrame, FanContentContainer } from "@/components/fan-shell/fan-app-shell";
import { NoticeDetail } from "@/components/notice/notice-detail";

export const dynamic = "force-dynamic";

export default async function NoticeDetailPage({ params, searchParams }: {
  params: Promise<{ slug: string; noticeSlug: string }>;
  searchParams: Promise<{ locale?: string }>;
}) {
  const { slug, noticeSlug } = await params;
  const locale = parseAppLocale((await searchParams).locale);
  return <FanAppFrame locale={locale} mainId="notice-detail-main"><FanContentContainer as="main" id="notice-detail-main" tabIndex={-1}>
    <NoticeDetail slug={slug} noticeSlug={noticeSlug} locale={locale} />
  </FanContentContainer></FanAppFrame>;
}
