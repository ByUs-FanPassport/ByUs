"use client";

import Link from "next/link";
import { FanSectionHeader } from "@/components/fan-ui/fan-heading";
import { useRouter } from "next/navigation";
import { ArrowRight, BadgeCheck, Camera, CalendarDays, MessageCircle, UsersRound } from "lucide-react";
import type { PublishedCelebrity } from "@/server/content/content-domain";
import { type AppLocale, toContentLocale } from "@/i18n/locales";
import { communityCopy } from "@/i18n/catalogs/features__community";
import { participationCopy } from "@/i18n/catalogs/features__schedules__ui__participation";
import { FanAppFrame, FanContentContainer } from "@/components/fan-shell/fan-app-shell";
import { CreatorAvatar } from "@/components/fan-ui/creator-avatar";
import { FanAction } from "@/components/fan-ui/fan-action";
import { FanPostFeed } from "@/features/fan-posts/ui/fan-post-feed";
import { CertificationPanel } from "@/features/certification/ui/certification-panel";
import { LeaderboardPanel } from "@/features/fanpage/ui/leaderboard-panel";
import { LEADERBOARD_MIN_FANS } from "@/features/fanpage/domain/community";
import { fanCommunitySchema } from "@/features/fanpage/domain/fan-community";
import { useCommunityResource } from "@/features/fanpage/ui/use-community-resource";
import { ResourceMessage } from "@/features/fanpage/ui/home-panels";
import { creatorHomeHref } from "@/features/creator/domain/creator-navigation";
import { COMMUNITY_TABS, communityHref, type CommunityTab } from "../domain/navigation";
import styles from "./community.module.css";

const parseFans = (value: unknown) => fanCommunitySchema.parse(value);

function CommunityFans({ slug, locale, compact = false }: { slug: string; locale: AppLocale; compact?: boolean }) {
  const copy = communityCopy(locale);
  const resource = useCommunityResource(`/api/celebrities/${slug}/fans?locale=${toContentLocale(locale)}`, parseFans);
  if (!compact && resource.state.status === "ready" && resource.state.data.fanCount >= LEADERBOARD_MIN_FANS) {
    return <LeaderboardPanel slug={slug} locale={locale} showGathering={false} />;
  }
  return <section className={styles.fans} aria-label={copy.recentFans}>
    <header><h2><UsersRound size={18} aria-hidden="true" />{copy.recentFans}</h2>
      {resource.state.status === "ready" && <span>{resource.state.data.fanCount.toLocaleString(locale)}{copy.countSuffix}</span>}
    </header>
    {resource.state.status === "ready" ? <>
      <p>{copy.fansIntro}</p>
      {resource.state.data.fans.length ? <ul className={compact ? styles.fanPreview : styles.fanList}>
        {resource.state.data.fans.slice(0, compact ? 6 : 24).map((fan, index) => <li key={`${fan.nickname}:${index}`}><img src={fan.avatarUrl} width={40} height={40} alt="" /><span>{fan.nickname}</span></li>)}
      </ul> : <p className={styles.empty}>{copy.noFans}</p>}
      {compact && <Link className={styles.textLink} href={communityHref(slug, locale, "fans")}>{copy.fans}<ArrowRight size={16} aria-hidden="true" /></Link>}
      {resource.refreshFailed && <ResourceMessage locale={locale} error retry={resource.retry} />}
    </> : <ResourceMessage locale={locale} error={resource.state.status === "error"} retry={resource.retry} />}
  </section>;
}

export function CommunityScreen({ creators, creator, locale, tab = "posts" }: {
  creators: readonly PublishedCelebrity[]; creator?: PublishedCelebrity; locale: AppLocale; tab?: CommunityTab;
}) {
  const copy = communityCopy(locale), participation = participationCopy(locale), router = useRouter();
  return <FanAppFrame locale={locale} currentPath="/community" mainId="community-main">
    <FanContentContainer as="main" id="community-main" className={styles.page} tabIndex={-1}>
      <FanSectionHeader as="h1" variant="editorial" title={copy.title} description={copy.intro} />
      {creator ? <>
        <div className={styles.creatorBar}>
          <CreatorAvatar slug={creator.slug} src={creator.image.url} photos={creator.image.photos} position={creator.image.position} size={48} />
          <div className={styles.selector}><label htmlFor="community-creator">{copy.choose}</label><select id="community-creator" value={creator.slug} onChange={event => router.push(communityHref(event.target.value, locale, tab))}>
            {creators.map(item => <option value={item.slug} key={item.slug}>{item.name}</option>)}
          </select></div>
          <Link className={styles.creatorLink} href={`${creatorHomeHref(creator.slug)}?locale=${locale}`}>{copy.fanpage}<ArrowRight size={16} aria-hidden="true" /></Link>
          <Link className={styles.liveLink} href={`${creatorHomeHref(creator.slug)}?tab=live&locale=${locale}#celebrity-content`}><CalendarDays size={16} aria-hidden="true" />LIVE</Link>
        </div>
        <nav className={styles.tabs} aria-label={copy.title}>{COMMUNITY_TABS.map(value => <Link key={value} href={communityHref(creator.slug, locale, value)} aria-current={tab === value ? "page" : undefined}>{copy[value]}</Link>)}</nav>
        <div className={styles.layout}>
          <div className={styles.mainColumn} key={`${creator.slug}:${tab}`}>
            {tab === "posts" ? <FanPostFeed slug={creator.slug} locale={locale} returnTo={communityHref(creator.slug, locale)} />
              : tab === "fans" ? <CommunityFans slug={creator.slug} locale={locale} />
              : tab === "certifications" ? <CertificationPanel slug={creator.slug} locale={locale} />
              : <section className={styles.requests}><h2>{copy.requests}</h2>
                <Link href={`/c/${creator.slug}/schedule-suggestions?locale=${locale}`}><CalendarDays aria-hidden="true" /><span>{participation.suggest}<small>{creator.name}</small></span><ArrowRight aria-hidden="true" /></Link>
                <Link href={`/bias/requests?locale=${locale}`}><UsersRound aria-hidden="true" /><span>{participation.fanpage}</span><ArrowRight aria-hidden="true" /></Link>
                <Link href={`/my/requests?locale=${locale}`}><MessageCircle aria-hidden="true" /><span>{participation.requests}</span><ArrowRight aria-hidden="true" /></Link>
              </section>}
          </div>
          <aside className={styles.sidebar}>
            <section className={styles.contribute}><Camera size={24} aria-hidden="true" /><h2>{copy.photoTitle}</h2><p>{copy.photoIntro}</p>
              <FanAction href={communityHref(creator.slug, locale)} trailingIcon={<ArrowRight />}>{copy.posts}</FanAction>
            </section>
            {tab !== "fans" && <CommunityFans slug={creator.slug} locale={locale} compact />}
            {tab !== "certifications" && <section className={styles.verify}><BadgeCheck size={24} aria-hidden="true" /><h2>{copy.certifications}</h2><p>{copy.verifyIntro}</p><Link className={styles.textLink} href={communityHref(creator.slug, locale, "certifications")}>{copy.certifications}<ArrowRight size={16} aria-hidden="true" /></Link></section>}
          </aside>
        </div>
      </> : <p className={styles.empty} role="status">{copy.empty}</p>}
    </FanContentContainer>
  </FanAppFrame>;
}
