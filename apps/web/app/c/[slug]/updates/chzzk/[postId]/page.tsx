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
  const locale = (await searchParams).locale === "en" ? "en" : "ko";
  const ko = locale === "ko";
  if (!/^[1-9]\d{0,14}$/.test(postId)) notFound();
  const creator = await createPublishedContentRepositoryFromEnvironment().findBySlug(locale, slug);
  const channelId = creator ? chzzkChannelId(creator.socialLinks) : null;
  if (!creator || !channelId) notFound();
  const communityUrl = `https://chzzk.naver.com/${channelId}/community`;
  let post: ChzzkPost | null = null;
  let unavailable = false;
  try { post = await readChzzkPost(postId, undefined, channelId); } catch { unavailable = true; }
  if (!post && !unavailable) notFound();
  return <FanAppFrame locale={locale} mainId="chzzk-detail-main">
    <FanContentContainer as="main" id="chzzk-detail-main" className={`${styles.page} ${styles.standalone}`} tabIndex={-1}>
      <Link className={styles.back} href={`/${slug}?tab=notice&locale=${locale}#celebrity-content`}><ArrowLeft aria-hidden="true" />{ko ? "소식 목록" : "All updates"}</Link>
      <article className={styles.article}>
        <header className={styles.header}><h1>{post ? chzzkPostTitle(post, locale) : (ko ? "소식을 불러오지 못했어요" : "Couldn't load this update")}</h1>
          {post && <div className={styles.meta}><span>{ko ? "치지직" : "CHZZK"}</span><time dateTime={post.date}>{post.date.replaceAll("-", ".")}</time></div>}
        </header>
        {post ? <ChzzkPostBody post={post} name={creator.name} locale={locale} communityUrl={communityUrl} /> : <p>{ko ? "잠시 후 다시 열어 주세요. " : "Please try again shortly. "}<a href={communityUrl} target="_blank" rel="noopener noreferrer">{ko ? "치지직에서 보기 (새 창)" : "View on CHZZK (new window)"}</a></p>}
      </article>
    </FanContentContainer>
  </FanAppFrame>;
}
