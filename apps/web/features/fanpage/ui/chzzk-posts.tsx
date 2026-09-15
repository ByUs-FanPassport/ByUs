"use client";

import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, ArrowUpRight, Pin } from "lucide-react";
import { useId, useState } from "react";
import { creatorHomeHref } from "@/features/creator/domain/creator-navigation";
import { CHZZK_COMMUNITY_URL, chzzkFeedSchema, type ChzzkPost } from "../domain/chzzk-posts";
import { creatorNewsItems, newsNoticesSchema, type NewsNotice } from "../domain/creator-news";
import styles from "./chzzk-posts.module.css";

import { useNewsSource } from "./use-news-source";
const parsePosts = (body: unknown) => chzzkFeedSchema.parse(body);
const parseNotices = (body: unknown) => { const page = newsNoticesSchema.parse(body); return {items:page.notices,nextCursor:page.nextCursor}; };
const postKey = (post: ChzzkPost) => post.id;
const noticeKey = (notice: NewsNotice) => notice.slug;

export type NewsFilter = "all" | "notice" | "chzzk";

export function CreatorNews({ slug, locale, full = false, initialFilter = "all", channelId = null }: { slug: string; locale: "ko" | "en"; full?: boolean; initialFilter?: NewsFilter; channelId?: string | null }) {
  const [selectedFilter, setFilter] = useState<NewsFilter>(initialFilter);
  const filter = channelId ? selectedFilter : "notice";
  const ko = locale === "ko";
  const titleId = useId();
  const posts = useNewsSource(channelId ? `/api/celebrities/${encodeURIComponent(slug)}/chzzk` : null, parsePosts, postKey);
  const notices = useNewsSource(`/api/public/celebrities/${encodeURIComponent(slug)}/notices?locale=${locale}`, parseNotices, noticeKey);
  const items = creatorNewsItems(filter === "chzzk" ? [] : notices.state.data ?? [], filter === "notice" ? [] : posts.state.data ?? [], locale, full);
  const sources = filter === "notice" ? [notices] : filter === "chzzk" ? [posts] : [notices, posts];
  const loading = sources.some((source) => source.state.status === "loading");
  const failed = sources.some((source) => source.state.status === "error");
  return <section className={styles.section} aria-labelledby={titleId}>
    <header className={styles.heading}>
      <h2 id={titleId}>{ko ? "소식" : "Updates"}</h2>
      {!full && <Link href={`${creatorHomeHref(slug)}?tab=notice&locale=${locale}${filter === "all" ? "" : `&news=${filter}`}#celebrity-content`}>{ko ? "전체 보기" : "View all"}<ArrowRight size={16} aria-hidden="true" /></Link>}
    </header>
    {channelId && <div className={styles.filters} role="group" aria-label={ko ? "소식 분류" : "Update categories"}>
      {(["all", "notice", "chzzk"] as const).map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "all" ? (ko ? "전체" : "All") : value === "notice" ? (ko ? "공지" : "Notices") : (ko ? "치지직" : "CHZZK")}</button>)}
    </div>}
    {items.length > 0 && <ul className={styles.list}>
      {items.map((item) => <li key={item.key}>
        <Link className={styles.row} href={(item.source === "byus" ? `/c/${slug}/notices/${item.notice.slug}?locale=${locale}` : `/c/${slug}/updates/chzzk/${item.post.id}?locale=${locale}`) as Route}>
          <span className={styles.rowContent}>
            <span className={styles.meta}>
              {item.source === "chzzk" ? <span className={styles.platform}><Image src="/images/guest-home/chzzk.png" width={16} height={16} alt="" />{ko ? "치지직" : "CHZZK"}</span>
                : <span className={styles.notice}>{item.pinned && <Pin size={12} aria-hidden="true" />}{item.notice.kind === "welcome" ? (ko ? "이용 안내" : "Start here") : (ko ? "공지" : "Notice")}</span>}
              <time dateTime={item.date}>{item.date.slice(0, 10).replaceAll("-", ".")}</time>
            </span>
            <span className={styles.title}>{item.title}</span>
          </span>
          {item.source === "chzzk" && item.post.images[0] && <NewsThumbnail key={item.post.images[0].url} url={item.post.images[0].url} />}
          <ArrowRight className={styles.rowArrow} size={16} aria-hidden="true" />
        </Link>
      </li>)}
    </ul>}
    {!items.length && loading && <p className={styles.feedback} role="status">{ko ? "소식을 불러오고 있어요." : "Loading updates."}</p>}
    {failed && <div className={styles.feedback}><span role="status">{items.length ? (ko ? "일부 소식을 불러오지 못했어요." : "Some updates couldn't be loaded.") : (ko ? "소식을 불러오지 못했어요." : "Couldn't load updates.")}</span><button onClick={() => { sources.forEach((source) => { if (source.state.status === "error") source.retry(); }); }}>{ko ? "다시 시도" : "Retry"}</button></div>}
    {!items.length && !loading && !failed && <p className={styles.feedback}>{filter === "notice" ? (ko ? "아직 공개된 공지가 없어요." : "No public notices yet.") : filter === "chzzk" ? (ko ? "아직 공개된 치지직 소식이 없어요." : "No public CHZZK updates yet.") : (ko ? "아직 공개된 소식이 없어요." : "No public updates yet.")}</p>}
    {full && sources.some(source => source.state.nextCursor) && <div className={styles.pagination}>
      <button type="button" disabled={sources.some(source => source.state.moreLoading)} onClick={() => sources.forEach(source => { if (source.state.nextCursor && (!sources.some(item => item.state.moreError) || source.state.moreError)) source.loadMore(); })}>{sources.some(source => source.state.moreLoading) ? (ko ? "불러오는 중…" : "Loading…") : (ko ? "더 보기" : "Load more")}</button>
      {sources.some(source => source.state.moreError) && <p role="status">{ko ? "다음 소식을 불러오지 못했어요. 더 보기를 눌러 다시 시도해 주세요." : "Couldn't load more updates. Select Load more to retry."}</p>}
    </div>}
    {full && channelId && filter !== "notice" && <a className={styles.source} href={`https://chzzk.naver.com/${channelId}/community`} target="_blank" rel="noopener noreferrer">{ko ? "치지직 커뮤니티, 새 창" : "CHZZK community, new window"}<ArrowUpRight size={14} aria-hidden="true" /></a>}
  </section>;
}

function NewsThumbnail({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? null : <Image className={styles.thumbnail} src={url} alt="" width={64} height={48} unoptimized referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

export function ChzzkPostBody({ post, name, locale, communityUrl = CHZZK_COMMUNITY_URL }: { post: ChzzkPost; name: string; locale: "ko" | "en"; communityUrl?: string }) {
  const ko = locale === "ko";
  return <div className={styles.body}>
    {post.text && <p className={styles.text}>{post.text}</p>}
    {post.images.map((image, index) => <PostImage key={image.url} url={image.url} label={ko ? `${name}의 ${post.date} 게시글 이미지 ${index + 1}` : `${name}'s post image ${index + 1}, ${post.date}`} ko={ko} />)}
    <a className={styles.source} href={communityUrl} target="_blank" rel="noopener noreferrer" aria-label={ko ? "치지직 원문 커뮤니티, 새 창" : "Original CHZZK community, new window"}>
      <Image src="/images/guest-home/chzzk.png" width={16} height={16} alt="" />{ko ? "치지직에서 보기" : "View on CHZZK"}<ArrowUpRight size={14} aria-hidden="true" />
    </a>
  </div>;
}

function PostImage({ url, label, ko }: { url: string; label: string; ko: boolean }) {
  const [failed, setFailed] = useState(false);
  return failed ? <p className={styles.imageError}>{ko ? "이미지를 불러오지 못했어요. 치지직에서 확인해 주세요." : "Couldn't load the image. View it on CHZZK."}</p>
    : <a className={styles.image} href={url} target="_blank" rel="noopener noreferrer" aria-label={`${label}, ${ko ? "크게 보기, 새 창" : "view full size, new window"}`}>
      <Image src={url} alt={label} width={1920} height={1080} unoptimized referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    </a>;
}
