import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FanAppFrame, FanContentContainer } from "../../../../../components/fan-shell/fan-app-shell";
import { NoticeBody } from "../../../../../components/notice/notice-body";
import { NoticeShare } from "../../../../../components/notice/notice-share";
import styles from "../../../../../components/notice/notice-detail.module.css";
import { loadServerEnv } from "../../../../../server/config/env";
import { createNoticeRepository } from "../../../../../server/notice/notice-repository";

export const dynamic = "force-dynamic";

function format(value: string, locale: "ko" | "en") {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    dateStyle: "long", timeStyle: "short", timeZone: "Asia/Seoul", hour12: locale !== "ko",
  }).format(new Date(value));
}

export default async function NoticeDetailPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string; noticeSlug: string }>;
  searchParams: Promise<{ locale?: string }>;
}) {
  const { slug, noticeSlug } = await params;
  const { locale: requestedLocale } = await searchParams;
  const locale = requestedLocale === "en" ? "en" : "ko";
  const env = loadServerEnv();
  const repository = createNoticeRepository({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
  const [notice, recent] = await Promise.all([
    repository.findPublic({ celebritySlug: slug, noticeSlug, locale }),
    repository.listPublic({ celebritySlug: slug, locale, limit: 6 }),
  ]);
  if (!notice) notFound();
  const recentNotices = recent.notices.filter((item) => item.slug !== noticeSlug).slice(0, 5);
  return <FanAppFrame locale={locale} mainId="notice-detail-main">
    <FanContentContainer as="main" id="notice-detail-main" className={styles.page} tabIndex={-1}>
      <Link className={styles.back} href={`/c/${slug}?tab=notice&locale=${locale}`}><ArrowLeft aria-hidden="true" />{locale === "ko" ? "셀럽 팬페이지로 돌아가기" : "Back to celebrity fan page"}</Link>
      <div className={styles.layout}>
        <article className={styles.article}>
          <header className={styles.header}><h1>{notice.title}</h1><div className={styles.meta}><time dateTime={notice.publishedAt}>{format(notice.publishedAt, locale)}</time><NoticeShare title={notice.title} locale={locale} /></div></header>
          <NoticeBody document={notice.body} locale={locale} />
        </article>
        {recentNotices.length > 0 && <aside className={styles.recent} aria-labelledby="recent-notices"><h2 id="recent-notices">{locale === "ko" ? "최근 공지" : "Recent Notices"}</h2>{recentNotices.map((item) => <Link key={item.slug} href={`/c/${slug}/notices/${item.slug}?locale=${locale}`}><strong>{item.title}</strong><small>{format(item.publishedAt, locale)}</small></Link>)}</aside>}
      </div>
    </FanContentContainer>
  </FanAppFrame>;
}
