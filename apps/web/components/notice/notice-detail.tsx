"use client";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { type AppLocale, toContentLocale } from "@/i18n/locales";
import { messages } from "@/i18n/catalogs/app__c___slug___notices___noticeSlug___page";
import { translate } from "@/i18n/messages";
import { contentCopy } from "@/i18n/catalogs/features__fan_posts__ui";
import { creatorHomeHref } from "@/features/creator/domain/creator-navigation";
import { noticeSchema } from "@/features/fan-posts/domain/content";
import { useCommunityResource } from "@/features/fanpage/ui/use-community-resource";
import { NoticeComments } from "@/features/fanpage/ui/notice-comments";
import { ContentActions, ContentTranslation } from "@/features/content-safety/ui/content-actions";
import { parseNoticeDocument } from "@/server/notice/notice-domain";
import { NoticeBody } from "./notice-body";
import { NoticeShare } from "./notice-share";
import styles from "./notice-detail.module.css";

const parseNotice = (value: unknown) => { const item = noticeSchema.parse(value); return { ...item, body: parseNoticeDocument(item.body) }; };
const parseRecent = (value: unknown) => z.object({ notices: z.array(noticeSchema.omit({ body: true })), nextCursor: z.string().nullable() }).parse(value);
export function NoticeDetail({ slug, noticeSlug, locale }: { slug: string; noticeSlug: string; locale: AppLocale }) {
  const copy = contentCopy(locale), base = `/api/celebrities/${slug}/notices`;
  const detail = useCommunityResource(`${base}/${noticeSlug}?locale=${toContentLocale(locale)}`, parseNotice, false);
  const recent = useCommunityResource(`${base}?locale=${toContentLocale(locale)}&limit=6`, parseRecent, false);
  const format = (value: string) => new Intl.DateTimeFormat(locale, { calendar: "gregory", dateStyle: "long", timeStyle: "short", timeZone: "Asia/Seoul", hour12: locale !== "ko" }).format(new Date(value));
  const related = recent.state.status === "ready" ? recent.state.data.notices.filter(item => item.slug !== noticeSlug).slice(0, 5) : [];
  const notice = detail.state.status === "ready" ? detail.state.data : null;
  return <div className={`${styles.page} ${related.length ? styles.withRecent : styles.standalone}`}>
    <Link className={styles.back} href={`${creatorHomeHref(slug)}?tab=notice&locale=${locale}`}><ArrowLeft aria-hidden="true" />{locale === "ko" ? "셀럽 팬페이지로 돌아가기" : translate(locale, messages.m4f111c5fca8e, "Back to celebrity fan page")}</Link>
    {!notice ? <p role={detail.state.status === "error" ? "alert" : "status"}>{detail.state.status === "error" ? copy.unavailable : copy.loading}{detail.state.status === "error" && <button type="button" onClick={detail.retry}>{copy.retry}</button>}</p> :
      <div className={`${styles.layout} ${related.length ? styles.relatedLayout : ""}`}>
        <article className={styles.article}>
          <header className={styles.header}><span>{notice.postType === "artist_post" ? copy.artistPost : copy.notice} · {copy[notice.visibility]}</span><h1>{notice.title}</h1><div className={styles.meta}><time dateTime={notice.publishedAt}>{format(notice.publishedAt)}</time><NoticeShare title={notice.title} locale={locale} /></div></header>
          <ContentTranslation targetType="notice" targetId={notice.id} sourceRevision={notice.revision} locale={locale}><NoticeBody document={notice.body} locale={locale} /></ContentTranslation>
          <ContentActions targetType="notice" targetId={notice.id} locale={locale} canBlock={false} onChanged={detail.retry} />
          <NoticeComments slug={slug} noticeSlug={noticeSlug} locale={locale} welcome={notice.kind === "welcome"} />
        </article>
        {related.length > 0 && <aside className={styles.recent} aria-labelledby="recent-notices"><h2 id="recent-notices">{locale === "ko" ? "최근 공지" : translate(locale, messages.mc51097f53111, "Recent Notices")}</h2>{related.map(item => <Link key={item.id} href={`/c/${slug}/notices/${item.slug}?locale=${locale}`}><strong>{item.title}</strong><small>{format(item.publishedAt)}</small></Link>)}</aside>}
      </div>}
  </div>;
}
