"use client";

import { usePrivy } from "@privy-io/react-auth";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";
import { ArrowRight, Book, ChevronRight, Clock, Play, Radio } from "./icons";
import { AuthIntentLink } from "./auth-intent-link";
import { FanCompactHeader } from "./fan-shell/fan-compact-header";
import type { ContentLocale, PublishedCelebrity, PublishedCelebrityLive } from "../server/content/content-domain";
import styles from "./celebrity-fan-page.module.css";

type OwnedPassport = Readonly<{ id?: unknown; celebrity?: Readonly<{ slug?: unknown }> }>;
type PassportState =
  | Readonly<{ status: "guest" | "loading" | "none" }>
  | Readonly<{ status: "owned"; id: string }>
  | Readonly<{ status: "error" }>;
const socialLabel = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram" } as const;
const copy = {
  ko: { directory: "셀럽 전체 보기", official: "OFFICIAL CELEBRITY", openPassport: "Passport 열기", passportError: "Passport 상태를 확인하지 못했어요.", retry: "다시 시도", checking: "Passport 상태 확인 중", verify: "팬 인증하기", sections: "팬페이지 섹션", noticeHelp: "의 공식 소식을 확인하세요.", noNotice: "등록된 Notice가 아직 없어요.", noNoticeHelp: "새 소식이 공개되면 이곳에서 확인할 수 있어요.", activity: "LIVE 및 활동", activityHelp: "공개된 LIVE와 팬 활동을 이어가세요.", liveDetails: "LIVE 자세히 보기", noLive: "예정된 LIVE가 아직 없어요.", noLiveHelp: "새로운 일정이 공개되면 이 페이지에서 바로 확인할 수 있어요.", passportAlt: "모든 Stamp 칸이 비어 있는 펼쳐진 Fan Passport", passportHelp: "팬 인증부터 LIVE 참여까지, 함께한 순간을 하나씩 기록해 보세요.", checkingLong: "Passport 상태를 확인하고 있어요.", checkAgain: "Passport 상태 다시 확인", profile: "Profile", officialSns: "공식 SNS", newWindow: "새 창에서 열기", noSns: "공개된 SNS 링크가 아직 없어요.", noSnsHelp: "공식 채널이 등록되면 이곳에 표시돼요." },
  en: { directory: "View all celebrities", official: "OFFICIAL CELEBRITY", openPassport: "Open Passport", passportError: "We couldn't check your Passport status.", retry: "Try again", checking: "Checking Passport status", verify: "Verify fandom", sections: "fan page sections", noticeHelp: " official updates.", noNotice: "No Notice has been published yet.", noNoticeHelp: "New official updates will appear here.", activity: "LIVE and activities", activityHelp: "Continue with published LIVE events and fan activities.", liveDetails: "View LIVE details", noLive: "No upcoming LIVE is published yet.", noLiveHelp: "New schedules will appear here when published.", passportAlt: "Opened Fan Passport with empty Stamp spaces", passportHelp: "Record every moment, from fan verification to LIVE participation.", checkingLong: "Checking your Passport status.", checkAgain: "Check Passport status again", profile: "Profile", officialSns: "official social channels", newWindow: "opens in a new window", noSns: "No official social links are published yet.", noSnsHelp: "Official channels will appear here when registered." },
} as const;

function formatLiveDate(value: string, locale: ContentLocale) {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value));
}

function findOwnedPassport(value: unknown, slug: string): string | null {
  if (!value || typeof value !== "object" || !("passports" in value) || !Array.isArray(value.passports)) {
    throw new Error("Invalid Passport collection");
  }
  const passport = (value.passports as OwnedPassport[]).find((item) => item.celebrity?.slug === slug);
  return passport && typeof passport.id === "string" ? passport.id : null;
}

export function CelebrityFanPage({ celebrity, locale, upcomingLive }: { celebrity: PublishedCelebrity; locale: ContentLocale; upcomingLive: PublishedCelebrityLive | null }) {
  const t = copy[locale];
  const localeQuery = `?locale=${locale}`;
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [requestKey, setRequestKey] = useState(0);
  const [passportState, setPassportState] = useState<PassportState>({ status: "loading" });

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) { setPassportState({ status: "guest" }); return; }
    const controller = new AbortController();
    setPassportState({ status: "loading" });
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Missing access token");
        const response = await fetch(`/api/passports?locale=${locale}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!response.ok) throw new Error("Passport request failed");
        const id = findOwnedPassport(await response.json(), celebrity.slug);
        setPassportState(id ? { status: "owned", id } : { status: "none" });
      } catch {
        if (!controller.signal.aborted) setPassportState({ status: "error" });
      }
    })();
    return () => controller.abort();
  }, [authenticated, celebrity.slug, getAccessToken, locale, ready, requestKey]);

  return (
    <main className={styles.page}>
      <FanCompactHeader brandAriaLabel={locale === "ko" ? "ByUs 홈" : "ByUs home"} brandHref={`/${localeQuery}` as Route}><Link className={styles.directoryLink} href={`/celebrities${localeQuery}`}>{t.directory} <ChevronRight /></Link></FanCompactHeader>
      <section className={styles.hero} aria-labelledby="celebrity-heading">
        <Image src={celebrity.image.url} alt={celebrity.image.alt} fill sizes="(min-width: 1024px) 1200px, 100vw" priority style={{ objectPosition: celebrity.image.position }} unoptimized={celebrity.image.url.startsWith("https://")} />
        <div className={styles.scrim} aria-hidden="true" />
        <div className={styles.heroCopy}><p>{t.official}</p><h1 id="celebrity-heading">{celebrity.name}</h1><span>{celebrity.summary}</span></div>
        <div className={styles.heroAction}>
          {passportState.status === "owned" ? <Link href={`/passports/${passportState.id}${localeQuery}`}><span>{t.openPassport}</span><ArrowRight /></Link>
            : passportState.status === "error" ? <div className={styles.ctaError} role="alert"><span>{t.passportError}</span><button type="button" onClick={() => setRequestKey((key) => key + 1)}>{t.retry}</button></div>
            : passportState.status === "loading" ? <span className={styles.ctaLoading} role="status">{t.checking}</span>
            : <AuthIntentLink focusKey="celebrity-hero-verification" locale={locale} input={{ sourcePath: `/c/${celebrity.slug}/verify`, sourceQuery: localeQuery, actionType: "START_FAN_VERIFICATION", targetType: "celebrity", targetId: celebrity.slug }}><span>{t.verify}</span><ArrowRight /></AuthIntentLink>}
        </div>
      </section>

      <nav className={styles.sectionNav} aria-label={`${celebrity.name} ${t.sections}`}>
        <a href="#notice">Notice</a><a href="#live-activity">LIVE · 활동</a><a href="#profile">Profile · SNS</a>
      </nav>

      <div className={styles.hubLayout}>
        <div className={styles.mainColumn}>
          <section className={styles.contentSection} id="notice" aria-labelledby="notice-title">
            <div className={styles.sectionHeading}><h2 id="notice-title">Notice</h2><p>{celebrity.name}{t.noticeHelp}</p></div>
            <div className={styles.inlineEmpty} role="status"><strong>{t.noNotice}</strong><span>{t.noNoticeHelp}</span></div>
          </section>

          <section className={styles.contentSection} id="live-activity" aria-labelledby="live-activity-title">
            <div className={styles.sectionHeading}><h2 id="live-activity-title">{t.activity}</h2><p>{t.activityHelp}</p></div>
            {upcomingLive ? <div className={styles.liveSection}><div className={styles.liveCopy}><p><Radio /> {upcomingLive.effectiveStatus === "live" ? "LIVE" : "UPCOMING LIVE"}</p><h3>{upcomingLive.title}</h3><span><Clock /> {formatLiveDate(upcomingLive.startsAt, locale)}</span></div><Link className={styles.liveAction} href={`/live/${upcomingLive.slug}${localeQuery}`}><span><Play /> {t.liveDetails}</span><ArrowRight /></Link></div> : <div className={styles.inlineEmpty} role="status"><strong>{t.noLive}</strong><span>{t.noLiveHelp}</span></div>}
          </section>

          <section className={styles.passportSection} aria-labelledby="passport-title"><div className={styles.passportImage}><Image src="/images/guest-home/passport-open-empty.png" alt={t.passportAlt} width={1536} height={1024} /></div><div className={styles.passportCopy}><Book /><h2 id="passport-title">{celebrity.name} Fan Passport</h2><p>{t.passportHelp}</p>{passportState.status === "owned" ? <Link href={`/passports/${passportState.id}${localeQuery}`}><span>{t.openPassport}</span><ArrowRight /></Link> : passportState.status === "error" ? <button type="button" onClick={() => setRequestKey((key) => key + 1)}>{t.checkAgain}</button> : passportState.status === "loading" ? <span className={styles.passportLoading} role="status">{t.checkingLong}</span> : <AuthIntentLink focusKey="celebrity-passport-verification" locale={locale} input={{ sourcePath: `/c/${celebrity.slug}/verify`, sourceQuery: localeQuery, actionType: "START_FAN_VERIFICATION", targetType: "celebrity", targetId: celebrity.slug }}><span>{t.verify}</span><ArrowRight /></AuthIntentLink>}</div></section>
        </div>

        <aside className={styles.profilePanel} id="profile" aria-labelledby="profile-title">
          <div className={styles.profilePortrait}><Image src={celebrity.image.url} alt="" width={144} height={144} style={{ objectPosition: celebrity.image.position }} unoptimized={celebrity.image.url.startsWith("https://")} /></div>
          <h2 id="profile-title">{celebrity.name} {t.profile}</h2>
          <p>{celebrity.summary}</p>
          {celebrity.socialLinks.length ? <div className={styles.socialLinks} role="group" aria-label={`${celebrity.name} ${t.officialSns}`}>{celebrity.socialLinks.map((social) => <a key={social.platform} href={social.url} target="_blank" rel="noreferrer" aria-label={`${celebrity.name} ${socialLabel[social.platform]} ${t.newWindow}`}><Image src={`/images/guest-home/${social.platform}.svg`} alt="" width={20} height={20} /><span>{socialLabel[social.platform]}</span></a>)}</div> : <div className={styles.socialEmpty} role="status"><strong>{t.noSns}</strong><span>{t.noSnsHelp}</span></div>}
        </aside>
      </div>
    </main>
  );
}
