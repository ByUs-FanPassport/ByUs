"use client";

import { toContentLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/features__fanpage__ui__chzzk-posts";
import { translate } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/locales";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, ArrowUpRight, Pin } from "lucide-react";
import { useId, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useByUsSession } from "@/components/byus-session-provider";
import { contentCopy } from "@/i18n/catalogs/features__fan_posts__ui";
import { creatorHomeHref } from "@/features/creator/domain/creator-navigation";
import { CHZZK_COMMUNITY_URL, chzzkFeedSchema, type ChzzkPost } from "../domain/chzzk-posts";
import { creatorNewsItems, newsNoticesSchema, type NewsNotice } from "../domain/creator-news";
import styles from "./chzzk-posts.module.css";

import { useNewsSource } from "./use-news-source";
const parsePosts = (body: unknown) => chzzkFeedSchema.parse(body);
const parseNotices = (body: unknown) => { const page = newsNoticesSchema.parse(body); return {items:page.notices,nextCursor:page.nextCursor}; };
const postKey = (post: ChzzkPost) => post.id;
const noticeKey = (notice: NewsNotice) => notice.slug;

export type NewsFilter = "all" | "notice" | "artist_post" | "chzzk";

export function CreatorNews({ slug, locale, full = false, initialFilter = "all", channelId = null }: { slug: string; locale: AppLocale; full?: boolean; initialFilter?: NewsFilter; channelId?: string | null }) {
  const [selectedFilter, setFilter] = useState<NewsFilter>(initialFilter);
  const filter = !channelId && selectedFilter === "chzzk" ? "all" : selectedFilter;
  const auth = usePrivy(), session = useByUsSession(), contentLabels = contentCopy(locale);
  const ko = locale === "ko";
  const titleId = useId();
  const posts = useNewsSource(channelId ? `/api/celebrities/${encodeURIComponent(slug)}/chzzk` : null, parsePosts, postKey);
  const notices = useNewsSource(`/api/celebrities/${encodeURIComponent(slug)}/notices?locale=${toContentLocale(locale)}`, parseNotices, noticeKey, {
    key: `${auth.ready}:${auth.authenticated}:${session.ownerId ?? auth.user?.id}:${session.generation}`, ready: auth.ready && session.ready,
    getToken: async () => { if (!auth.authenticated) return null; const token = await auth.getAccessToken(); if (!token) throw new Error("AUTHENTICATION_REQUIRED"); return token; },
  });
  const noticeItems = filter === "chzzk" ? [] : notices.state.data.filter(notice => filter === "all" || (notice.postType ?? "notice") === filter);
  const items = creatorNewsItems(noticeItems, filter === "all" || filter === "chzzk" ? posts.state.data : [], locale, full);
  const sources = filter === "notice" || filter === "artist_post" ? [notices] : filter === "chzzk" ? [posts] : [notices, posts];
  const loading = sources.some((source) => source.state.status === "loading");
  const failed = sources.some((source) => source.state.status === "error");
  return <section className={styles.section} aria-labelledby={titleId}>
    <header className={styles.heading}>
      <h2 id={titleId}>{locale === "ko" ? "소식" : translate(locale, localizedMessages.m1672ef751316, "Updates")}</h2>
      {!full && <Link href={`${creatorHomeHref(slug)}?tab=notice&locale=${locale}${filter === "all" ? "" : `&news=${filter}`}#celebrity-content`}>{locale === "ko" ? "전체 보기" : translate(locale, localizedMessages.m3e5383762d51, "View all")}<ArrowRight size={16} aria-hidden="true" /></Link>}
    </header>
    <div className={styles.filters} role="group" aria-label={locale === "ko" ? "소식 분류" : translate(locale, localizedMessages.me557c4702ff6, "Update categories")}>
      {(["all", "notice", "artist_post", ...(channelId ? ["chzzk"] : [])] as NewsFilter[]).map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "all" ? (locale === "ko" ? "전체" : translate(locale, localizedMessages.m1ca728a7e66c, "All")) : value === "notice" ? (locale === "ko" ? "공지" : translate(locale, localizedMessages.m237c0328b7ea, "Notices")) : value === "artist_post" ? contentLabels.artistPost : (locale === "ko" ? "치지직" : translate(locale, localizedMessages.m9fb648fbd0b4, "CHZZK"))}</button>)}
    </div>
    {items.length > 0 && <ul className={styles.list}>
      {items.map((item) => <li key={item.key}>
        <Link className={styles.row} href={(item.source === "byus" ? `/c/${slug}/notices/${item.notice.slug}?locale=${locale}` : `/c/${slug}/updates/chzzk/${item.post.id}?locale=${locale}`) as Route}>
          <span className={styles.rowContent}>
            <span className={styles.meta}>
              {item.source === "chzzk" ? <span className={styles.platform}><Image src="/images/guest-home/chzzk.png" width={16} height={16} alt="" />{locale === "ko" ? "치지직" : translate(locale, localizedMessages.m9fb648fbd0b4, "CHZZK")}</span>
                : <span className={styles.notice}>{item.pinned && <Pin size={12} aria-hidden="true" />}{item.notice.postType === "artist_post" ? contentLabels.artistPost : item.notice.kind === "welcome" ? (locale === "ko" ? "이용 안내" : translate(locale, localizedMessages.m1160110e13ea, "Start here")) : contentLabels.notice}{item.notice.visibility === "members" ? ` · ${contentLabels.members}` : ""}</span>}
              <time dateTime={item.date}>{item.date.slice(0, 10).replaceAll("-", ".")}</time>
            </span>
            <span className={styles.title}>{item.title}</span>
          </span>
          {item.source === "chzzk" && item.post.images[0] && <NewsThumbnail key={item.post.images[0].url} url={item.post.images[0].url} />}
          <ArrowRight className={styles.rowArrow} size={16} aria-hidden="true" />
        </Link>
      </li>)}
    </ul>}
    {!items.length && loading && <p className={styles.feedback} role="status">{locale === "ko" ? "소식을 불러오고 있어요." : translate(locale, localizedMessages.m761de726ce49, "Loading updates.")}</p>}
    {failed && <div className={styles.feedback}><span role="status">{items.length ? (locale === "ko" ? "일부 소식을 불러오지 못했어요." : translate(locale, localizedMessages.me4b4e8ab66f1, "Some updates couldn't be loaded.")) : (locale === "ko" ? "소식을 불러오지 못했어요." : translate(locale, localizedMessages.m410455f09dcc, "Couldn't load updates."))}</span><button onClick={() => { sources.forEach((source) => { if (source.state.status === "error") source.retry(); }); }}>{locale === "ko" ? "다시 시도" : translate(locale, localizedMessages.m158760d5a4ca, "Retry")}</button></div>}
    {!items.length && !loading && !failed && <p className={styles.feedback}>{filter === "notice" ? (locale === "ko" ? "아직 공개된 공지가 없어요." : translate(locale, localizedMessages.m25d5632ac746, "No public notices yet.")) : filter === "chzzk" ? (locale === "ko" ? "아직 공개된 치지직 소식이 없어요." : translate(locale, localizedMessages.mfacc92ea1b06, "No public CHZZK updates yet.")) : (locale === "ko" ? "아직 공개된 소식이 없어요." : translate(locale, localizedMessages.m7850d3d1cee2, "No public updates yet."))}</p>}
    {full && sources.some(source => source.state.nextCursor) && <div className={styles.pagination}>
      <button type="button" disabled={sources.some(source => source.state.moreLoading)} onClick={() => sources.forEach(source => { if (source.state.nextCursor && (!sources.some(item => item.state.moreError) || source.state.moreError)) source.loadMore(); })}>{sources.some(source => source.state.moreLoading) ? (locale === "ko" ? "불러오는 중…" : translate(locale, localizedMessages.m9b11aaea717a, "Loading…")) : (locale === "ko" ? "더 보기" : translate(locale, localizedMessages.m4f5d625cf937, "Load more"))}</button>
      {sources.some(source => source.state.moreError) && <p role="status">{locale === "ko" ? "다음 소식을 불러오지 못했어요. 더 보기를 눌러 다시 시도해 주세요." : translate(locale, localizedMessages.m857e081a72b4, "Couldn't load more updates. Select Load more to retry.")}</p>}
    </div>}
    {full && channelId && filter !== "notice" && <a className={styles.source} href={`https://chzzk.naver.com/${channelId}/community`} target="_blank" rel="noopener noreferrer">{locale === "ko" ? "치지직 커뮤니티, 새 창" : translate(locale, localizedMessages.m5792e3938ebf, "CHZZK community, new window")}<ArrowUpRight size={14} aria-hidden="true" /></a>}
  </section>;
}

function NewsThumbnail({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? null : <Image className={styles.thumbnail} src={url} alt="" width={64} height={48} unoptimized referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

export function ChzzkPostBody({ post, name, locale, communityUrl = CHZZK_COMMUNITY_URL }: { post: ChzzkPost; name: string; locale: AppLocale; communityUrl?: string }) {
  const ko = locale === "ko";
  return <div className={styles.body}>
    {post.text && <p className={styles.text}>{post.text}</p>}
    {post.images.map((image, index) => <PostImage key={image.url} url={image.url} label={locale === "ko" ? `${name}의 ${post.date} 게시글 이미지 ${index + 1}` : translate(locale, localizedMessages.m0a04b73a06e4, "{0}'s post image {1}, {2}", [name, index + 1, post.date])} locale={locale} />)}
    <a className={styles.source} href={communityUrl} target="_blank" rel="noopener noreferrer" aria-label={locale === "ko" ? "치지직 원문 커뮤니티, 새 창" : translate(locale, localizedMessages.mfb4459d72d21, "Original CHZZK community, new window")}>
      <Image src="/images/guest-home/chzzk.png" width={16} height={16} alt="" />{locale === "ko" ? "치지직에서 보기" : translate(locale, localizedMessages.m9a1ae798634c, "View on CHZZK")}<ArrowUpRight size={14} aria-hidden="true" />
    </a>
  </div>;
}

function PostImage({ url, label, locale }: { url: string; label: string; locale: AppLocale }) {
  const [failed, setFailed] = useState(false);
  return failed ? <p className={styles.imageError}>{locale === "ko" ? "이미지를 불러오지 못했어요. 치지직에서 확인해 주세요." : translate(locale, localizedMessages.md7bc5868acc7, "Couldn't load the image. View it on CHZZK.")}</p>
    : <a className={styles.image} href={url} target="_blank" rel="noopener noreferrer" aria-label={`${label}, ${locale === "ko" ? "크게 보기, 새 창" : translate(locale, localizedMessages.med87ccbc2470, "view full size, new window")}`}>
      <Image src={url} alt={label} width={1920} height={1080} unoptimized referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    </a>;
}
