"use client";

import { toContentLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/features__fanpage__ui__fan-community";
import { translate } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/locales";
import { creatorHomeHref } from "@/features/creator/domain/creator-navigation";

import Link from "next/link";
import type { Route } from "next";
import { Heart, MoreHorizontal } from "lucide-react";
import { fanCommunitySchema } from "../domain/fan-community";
import { useCommunityResource } from "./use-community-resource";
import styles from "./fan-community.module.css";

const parse = (value: unknown) => fanCommunitySchema.parse(value);
export function FanCommunity({ slug, locale }: { slug: string; locale: AppLocale }) {
  const resource = useCommunityResource(`/api/celebrities/${slug}/fans?locale=${toContentLocale(locale)}`, parse);
  const ko = locale === "ko";
  if (resource.state.status !== "ready") return <div className={styles.fans} role="status">{resource.state.status === "error"
    ? <button onClick={resource.retry}>{locale === "ko" ? "팬 수 다시 보기" : translate(locale, localizedMessages.mca462a03bf82, "Retry fan count")}</button>
    : <span>{locale === "ko" ? "팬 수 확인 중" : translate(locale, localizedMessages.m292a6a1a33f7, "Loading fans")}</span>}</div>;
  const { fanCount, fans } = resource.state.data;
  return <div className={styles.fans} data-fan-community>
    <Link href={`${creatorHomeHref(slug)}?tab=leaderboard&locale=${locale}#celebrity-content` as Route} className={styles.fanTrigger} aria-label={locale === "ko" ? `함께하는 팬 ${fanCount.toLocaleString("ko-KR")}명 보기` : translate(locale, localizedMessages.mbf74c4bd9ef4, "View {0} fans", [fanCount.toLocaleString("en-US")])}>
      <Heart size={15} aria-hidden="true" />
      {fans.length > 0 && <span className={styles.avatars} aria-hidden="true">
        {fans.slice(0, 5).map((fan, index) => <span key={`${fan.nickname}:${index}`}><img src={fan.avatarUrl} width={24} height={24} alt="" /></span>)}
        <span className={styles.more}><MoreHorizontal size={15} /></span>
      </span>}
      <span className={styles.fanCount}>{ko ? <><strong>{fanCount.toLocaleString("ko-KR")}명</strong>이 함께해요</> : locale === "en" ? <><strong>{fanCount.toLocaleString("en-US")}</strong> {fanCount === 1 ? "fan" : "fans"}</> : translate(locale, localizedMessages.m01d02e7914b6, "{0} fans", [fanCount.toLocaleString(locale)])}</span>
    </Link>
    {resource.refreshFailed && <button onClick={resource.retry}>{locale === "ko" ? "새로고침" : translate(locale, localizedMessages.mbff25be97bcc, "Refresh")}</button>}
  </div>;
}
