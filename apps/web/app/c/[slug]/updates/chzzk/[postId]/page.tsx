import { messages as localizedMessages } from "@/i18n/catalogs/app__c___slug___updates__chzzk___postId___page";
import { translate } from "@/i18n/messages";
import { toContentLocale } from "@/i18n/locales";
import { parseAppLocale } from "@/i18n/locales";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { FanAppFrame, FanContentContainer } from "@/components/fan-shell/fan-app-shell";
import styles from "@/components/notice/notice-detail.module.css";
import { chzzkChannelId, type ChzzkPost } from "@/features/fanpage/domain/chzzk-posts";
import { chzzkPostTitle } from "@/features/fanpage/domain/creator-news";
import { ChzzkPostBody } from "@/features/fanpage/ui/chzzk-posts";
import { readChzzkPost } from "@/server/chzzk/community";
import { createPublishedContentRepositoryFromEnvironment } from "@/server/content/published-content-repository";

export const dynamic = "force-dynamic";

export default async function ChzzkDetailPage({ params, searchParams }: {
  params: Promise<{ slug: string; postId: string }>;
  searchParams: Promise<{ locale?: string }>;
}) {
  const { slug, postId } = await params;
  const locale = parseAppLocale((await searchParams).locale);
  const ko = locale === "ko";
  if (!/^[1-9]\d{0,14}$/.test(postId)) notFound();
  const creator = await createPublishedContentRepositoryFromEnvironment().findBySlug(toContentLocale(locale), slug);
  const channelId = creator ? chzzkChannelId(creator.socialLinks) : null;
  if (!creator || !channelId) notFound();
  const communityUrl = `https://chzzk.naver.com/${channelId}/community`;
  let post: ChzzkPost | null = null;
  let unavailable = false;
  try { post = await readChzzkPost(postId, undefined, channelId); } catch { unavailable = true; }
  if (!post && !unavailable) notFound();
  return <FanAppFrame locale={locale} mainId="chzzk-detail-main">
    <FanContentContainer as="main" id="chzzk-detail-main" className={`${styles.page} ${styles.standalone}`} tabIndex={-1}>
      <Link className={styles.back} href={`/${slug}?tab=notice&locale=${locale}#celebrity-content`}><ArrowLeft aria-hidden="true" />{locale === "ko" ? "소식 목록" : translate(locale, localizedMessages.mafa93c1c71bf, "All updates")}</Link>
      <article className={styles.article}>
        <header className={styles.header}><h1>{post ? chzzkPostTitle(post, locale) : (locale === "ko" ? "소식을 불러오지 못했어요" : translate(locale, localizedMessages.m451dc28c270a, "Couldn't load this update"))}</h1>
          {post && <div className={styles.meta}><span>{locale === "ko" ? "치지직" : translate(locale, localizedMessages.m95155b6fa4d3, "CHZZK")}</span><time dateTime={post.date}>{post.date.replaceAll("-", ".")}</time></div>}
        </header>
        {post ? <ChzzkPostBody post={post} name={creator.name} locale={locale} communityUrl={communityUrl} /> : <p>{locale === "ko" ? "잠시 후 다시 열어 주세요. " : translate(locale, localizedMessages.m5df212fc0241, "Please try again shortly. ")}<a href={communityUrl} target="_blank" rel="noopener noreferrer">{locale === "ko" ? "치지직에서 보기 (새 창)" : translate(locale, localizedMessages.me04e9ef06943, "View on CHZZK (new window)")}</a></p>}
      </article>
    </FanContentContainer>
  </FanAppFrame>;
}
