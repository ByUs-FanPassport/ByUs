"use client";
import Link from "next/link";
import type { Route } from "next";
import { Heart, MoreHorizontal } from "lucide-react";
import { fanCommunitySchema } from "../domain/fan-community";
import { useCommunityResource } from "./use-community-resource";
import styles from "./fan-community.module.css";

const parse = (value: unknown) => fanCommunitySchema.parse(value);
export function FanCommunity({ slug, locale }: { slug: string; locale: "ko" | "en" }) {
  const resource = useCommunityResource(`/api/celebrities/${slug}/fans?locale=${locale}`, parse);
  const ko = locale === "ko";
  if (resource.state.status !== "ready") return <div className={styles.fans} role="status">{resource.state.status === "error"
    ? <button onClick={resource.retry}>{ko ? "팬 수 다시 보기" : "Retry fan count"}</button>
    : <span>{ko ? "팬 수 확인 중" : "Loading fans"}</span>}</div>;
  const { fanCount, fans } = resource.state.data;
  return <div className={styles.fans} data-fan-community>
    <Link href={`/c/${slug}?tab=leaderboard&locale=${locale}#celebrity-content` as Route} className={styles.fanTrigger} aria-label={ko ? `함께하는 팬 ${fanCount.toLocaleString("ko-KR")}명 보기` : `View ${fanCount.toLocaleString("en-US")} fans`}>
      <Heart size={15} aria-hidden="true" />
      {fans.length > 0 && <span className={styles.avatars} aria-hidden="true">
        {fans.slice(0, 5).map((fan, index) => <span key={`${fan.nickname}:${index}`}><img src={fan.avatarUrl} width={24} height={24} alt="" /></span>)}
        <span className={styles.more}><MoreHorizontal size={15} /></span>
      </span>}
      <span className={styles.fanCount}>{ko ? <><strong>{fanCount.toLocaleString("ko-KR")}명</strong>이 함께해요</> : <><strong>{fanCount.toLocaleString("en-US")}</strong> {fanCount === 1 ? "fan" : "fans"}</>}</span>
    </Link>
    {resource.refreshFailed && <button onClick={resource.retry}>{ko ? "새로고침" : "Refresh"}</button>}
  </div>;
}
