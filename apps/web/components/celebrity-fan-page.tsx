"use client";

import { usePrivy } from "@privy-io/react-auth";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowRight, Clock, Play, Radio } from "./icons";
import { AuthIntentLink } from "./auth-intent-link";
import { FanAppFrame, FanContentContainer } from "./fan-shell/fan-app-shell";
import type { ContentLocale, PublishedCelebrity, PublishedCelebrityLive } from "../server/content/content-domain";
import styles from "./celebrity-fan-page.module.css";

export type CelebrityFanTab = "home" | "notice" | "live" | "benefits";
type OwnedPassport = Readonly<{ id?: unknown; celebrity?: Readonly<{ slug?: unknown }> }>;
type PassportState =
  | Readonly<{ status: "guest" | "loading" | "none" }>
  | Readonly<{ status: "owned"; id: string }>
  | Readonly<{ status: "error" }>;
type AsyncState<T> =
  | Readonly<{ status: "idle" | "loading" }>
  | Readonly<{ status: "ready"; data: T }>
  | Readonly<{ status: "error" }>;
type Notice = Readonly<{ slug: string; title: string; pinned: boolean; publishedAt: string }>;
type LiveItem = Readonly<{ slug: string; title: string; startsAt: string; effectiveStatus: string; celebrity: { slug: string } }>;
type Benefit = Readonly<{ id: string; title: string; summary: string; eligibilityLabel: string; state: string }>;

const tabs: CelebrityFanTab[] = ["home", "notice", "live", "benefits"];
const socialLabel = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram" } as const;
const copy = {
  ko: {
    official: "OFFICIAL CELEBRITY", openPassport: "Passport 열기", passportError: "Passport 상태를 확인하지 못했어요.",
    retry: "다시 시도", checking: "Passport 상태 확인 중", verify: "팬 인증하기", sections: "팬페이지 메뉴",
    tabs: { home: "홈", notice: "공지", live: "LIVE", benefits: "혜택" },
    noNotice: "등록된 공지가 아직 없어요.", noNoticeHelp: "새 소식이 공개되면 이곳에서 확인할 수 있어요.",
    noticeError: "공지를 불러오지 못했어요.", pinned: "고정", liveHeading: "LIVE", liveHelp: "공개된 LIVE와 다시보기를 확인하세요.",
    liveDetails: "LIVE 자세히 보기", noLive: "공개된 LIVE가 아직 없어요.", noLiveHelp: "새로운 일정이 공개되면 이곳에 표시돼요.",
    benefitHeading: "혜택", benefitHelp: "함께한 활동으로 열리는 혜택을 확인하세요.", benefitError: "혜택을 불러오지 못했어요.",
    noBenefits: "공개된 혜택이 아직 없어요.", allBenefits: "전체 혜택 보기", passportAlt: "모든 Stamp 칸이 비어 있는 펼쳐진 Fan Passport",
    passportHelp: "팬 인증부터 LIVE 참여까지, 함께한 순간을 하나씩 기록해 보세요.", checkingLong: "Passport 상태를 확인하고 있어요.",
    checkAgain: "Passport 상태 다시 확인", profile: "Profile", officialSns: "공식 SNS", newWindow: "새 창",
    noSns: "공개된 SNS 링크가 아직 없어요.", noSnsHelp: "공식 채널이 등록되면 이곳에 표시돼요.", nextLive: "다음 LIVE",
  },
  en: {
    official: "OFFICIAL CELEBRITY", openPassport: "Open Passport", passportError: "We couldn't check your Passport status.",
    retry: "Try again", checking: "Checking Passport status", verify: "Verify fandom", sections: "fan page menu",
    tabs: { home: "Home", notice: "Notice", live: "LIVE", benefits: "Benefits" },
    noNotice: "No Notice has been published yet.", noNoticeHelp: "New official updates will appear here.",
    noticeError: "We couldn't load Notices.", pinned: "Pinned", liveHeading: "LIVE", liveHelp: "Explore published LIVE events and replays.",
    liveDetails: "View LIVE details", noLive: "No LIVE has been published yet.", noLiveHelp: "New schedules will appear here.",
    benefitHeading: "Benefits", benefitHelp: "Discover benefits unlocked by your fan activities.", benefitError: "We couldn't load benefits.",
    noBenefits: "No benefit has been published yet.", allBenefits: "View all benefits", passportAlt: "Opened Fan Passport with empty Stamp spaces",
    passportHelp: "Record every moment, from fan verification to LIVE participation.", checkingLong: "Checking your Passport status.",
    checkAgain: "Check Passport status again", profile: "Profile", officialSns: "official social channels", newWindow: "new window",
    noSns: "No official social links are published yet.", noSnsHelp: "Official channels will appear here.", nextLive: "Next LIVE",
  },
} as const;

function formatDate(value: string, locale: ContentLocale) {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    dateStyle: "medium", timeStyle: "short", hour12: locale !== "ko", timeZone: "Asia/Seoul",
  }).format(new Date(value));
}
function findOwnedPassport(value: unknown, slug: string): string | null {
  if (!value || typeof value !== "object" || !("passports" in value) || !Array.isArray(value.passports)) throw new Error("Invalid Passport collection");
  const passport = (value.passports as OwnedPassport[]).find((item) => item.celebrity?.slug === slug);
  return passport && typeof passport.id === "string" ? passport.id : null;
}

export function CelebrityFanPage({
  celebrity, locale, upcomingLive, initialTab,
}: {
  celebrity: PublishedCelebrity;
  locale: ContentLocale;
  upcomingLive: PublishedCelebrityLive | null;
  initialTab?: CelebrityFanTab;
}) {
  const t = copy[locale];
  const localeQuery = `?locale=${locale}`;
  const router = useRouter();
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [requestKey, setRequestKey] = useState(0);
  const [passportState, setPassportState] = useState<PassportState>({ status: "loading" });
  const [noticeState, setNoticeState] = useState<AsyncState<Notice[]>>({ status: "idle" });
  const [liveState, setLiveState] = useState<AsyncState<LiveItem[]>>({ status: "idle" });
  const [benefitState, setBenefitState] = useState<AsyncState<Benefit[]>>({ status: "idle" });
  const activeTab = initialTab ?? "home";

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
      } catch { if (!controller.signal.aborted) setPassportState({ status: "error" }); }
    })();
    return () => controller.abort();
  }, [authenticated, celebrity.slug, getAccessToken, locale, ready, requestKey]);

  useEffect(() => {
    if (activeTab === "notice" && noticeState.status === "idle") {
      setNoticeState({ status: "loading" });
      fetch(`/api/public/celebrities/${celebrity.slug}/notices?locale=${locale}`)
        .then((response) => { if (!response.ok) throw new Error(); return response.json(); })
        .then((payload) => setNoticeState({ status: "ready", data: payload.notices }))
        .catch(() => setNoticeState({ status: "error" }));
    }
    if (activeTab === "live" && liveState.status === "idle") {
      setLiveState({ status: "loading" });
      fetch(`/api/live-events?locale=${locale}`)
        .then((response) => { if (!response.ok) throw new Error(); return response.json(); })
        .then((payload) => setLiveState({ status: "ready", data: (payload.catalog ?? []).filter((live: LiveItem) => live.celebrity.slug === celebrity.slug) }))
        .catch(() => setLiveState({ status: "error" }));
    }
    if (activeTab === "benefits" && benefitState.status === "idle") {
      setBenefitState({ status: "loading" });
      void (async () => {
        try {
          const token = authenticated ? await getAccessToken() : null;
          const response = await fetch(`/api/benefits?celebrity=${celebrity.slug}&locale=${locale}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          });
          if (!response.ok) throw new Error();
          const payload = await response.json();
          setBenefitState({ status: "ready", data: (payload.benefits ?? []).slice(0, 3) });
        } catch { setBenefitState({ status: "error" }); }
      })();
    }
  }, [activeTab, authenticated, benefitState.status, celebrity.slug, getAccessToken, liveState.status, locale, noticeState.status]);

  const tabHref = (tab: CelebrityFanTab) => `/c/${celebrity.slug}?tab=${tab}&locale=${locale}` as Route;
  function tabKeyDown(event: KeyboardEvent<HTMLAnchorElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    router.push(tabHref(tabs[target]));
  }
  const passportAction = useMemo(() => passportState.status === "owned"
    ? <Link href={`/passports/${passportState.id}${localeQuery}`}><span>{t.openPassport}</span><ArrowRight /></Link>
    : passportState.status === "error"
      ? <button type="button" onClick={() => setRequestKey((key) => key + 1)}>{t.checkAgain}</button>
      : passportState.status === "loading"
        ? <span className={styles.passportLoading} role="status">{t.checkingLong}</span>
        : <AuthIntentLink focusKey="celebrity-passport-verification" locale={locale} input={{ sourcePath: `/c/${celebrity.slug}/verify`, sourceQuery: `?tab=home&locale=${locale}`, actionType: "START_FAN_VERIFICATION", targetType: "celebrity", targetId: celebrity.slug }}><span>{t.verify}</span><ArrowRight /></AuthIntentLink>,
  [celebrity.slug, locale, localeQuery, passportState, t]);

  return (
    <FanAppFrame locale={locale} mainId="celebrity-detail-main">
      <FanContentContainer as="main" id="celebrity-detail-main" className={styles.page} tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="celebrity-heading">
          <Image src={celebrity.image.url} alt={celebrity.image.alt} fill sizes="(min-width: 1024px) 1360px, 100vw" priority style={{ objectPosition: celebrity.image.position }} unoptimized={celebrity.image.url.startsWith("https://")} />
          <div className={styles.scrim} aria-hidden="true" />
          <div className={styles.heroCopy}><p>{t.official}</p><h1 id="celebrity-heading">{celebrity.name}</h1><span>{celebrity.summary}</span></div>
          <div className={styles.heroAction}>
            {passportState.status === "owned" ? <Link href={`/passports/${passportState.id}${localeQuery}`}><span>{t.openPassport}</span><ArrowRight /></Link>
              : passportState.status === "error" ? <div className={styles.ctaError} role="alert"><span>{t.passportError}</span><button type="button" onClick={() => setRequestKey((key) => key + 1)}>{t.retry}</button></div>
              : passportState.status === "loading" ? <span className={styles.ctaLoading} role="status">{t.checking}</span>
              : <AuthIntentLink focusKey="celebrity-hero-verification" locale={locale} input={{ sourcePath: `/c/${celebrity.slug}/verify`, sourceQuery: `?tab=${activeTab}&locale=${locale}`, actionType: "START_FAN_VERIFICATION", targetType: "celebrity", targetId: celebrity.slug }}><span>{t.verify}</span><ArrowRight /></AuthIntentLink>}
          </div>
        </section>

        <nav className={styles.sectionNav} aria-label={`${celebrity.name} ${t.sections}`} role="tablist">
          {tabs.map((tab, index) => <Link key={tab} href={tabHref(tab)} role="tab" aria-selected={activeTab === tab} aria-controls={`celebrity-${tab}-panel`} tabIndex={activeTab === tab ? 0 : -1} onKeyDown={(event) => tabKeyDown(event, index)}>{t.tabs[tab]}</Link>)}
        </nav>

        <section id={`celebrity-${activeTab}-panel`} role="tabpanel" className={styles.tabPanel}>
          {activeTab === "home" && <div className={styles.homeGrid}>
            <section className={styles.passportSection} aria-labelledby="passport-title">
              <div className={styles.passportImage}><Image src="/images/guest-home/passport-open-empty.png" alt={t.passportAlt} width={1536} height={1024} /></div>
              <div className={styles.passportCopy}><h2 id="passport-title">{celebrity.name} Fan Passport</h2><p>{t.passportHelp}</p>{passportAction}</div>
            </section>
            <div className={styles.homeAside}>
              <section className={styles.profilePanel} aria-labelledby="profile-title">
                <div className={styles.profilePortrait}><Image src={celebrity.image.url} alt="" width={144} height={144} style={{ objectPosition: celebrity.image.position }} unoptimized={celebrity.image.url.startsWith("https://")} /></div>
                <h2 id="profile-title">{celebrity.name} {t.profile}</h2><p>{celebrity.summary}</p>
                {celebrity.socialLinks.length ? <div className={styles.socialLinks} role="group" aria-label={`${celebrity.name} ${t.officialSns}`}>{celebrity.socialLinks.map((social) => <a key={social.platform} href={social.url} target="_blank" rel="noreferrer" aria-label={`${socialLabel[social.platform]} ${locale === "ko" ? "열기" : "open"}: ${celebrity.name}, ${t.newWindow}`}><Image src={`/images/guest-home/${social.platform}.svg`} alt="" width={20} height={20} /><span>{socialLabel[social.platform]}</span></a>)}</div> : <div className={styles.socialEmpty} role="status"><strong>{t.noSns}</strong><span>{t.noSnsHelp}</span></div>}
              </section>
              <section className={styles.nextLive}><h2>{t.nextLive}</h2>{upcomingLive ? <><h3>{upcomingLive.title}</h3><p><Clock />{formatDate(upcomingLive.startsAt, locale)}</p><Link href={`/live/${upcomingLive.slug}${localeQuery}`}>{t.liveDetails}<ArrowRight /></Link></> : <div className={styles.inlineEmpty}><strong>{t.noLive}</strong><span>{t.noLiveHelp}</span></div>}</section>
            </div>
          </div>}

          {activeTab === "notice" && <TabSection title={t.tabs.notice} help={`${celebrity.name}${locale === "ko" ? "의 공식 소식을 확인하세요." : " official updates."}`}>
            {noticeState.status !== "ready"
              ? noticeState.status === "error" ? <ErrorState text={t.noticeError} /> : <Loading locale={locale} />
              : noticeState.data.length === 0 ? <Empty title={t.noNotice} help={t.noNoticeHelp} />
              : <div className={styles.noticeList}>{noticeState.data.map((notice: Notice) => <Link key={notice.slug} href={`/c/${celebrity.slug}/notices/${notice.slug}?locale=${locale}`}><span>{notice.pinned && <em>{t.pinned}</em>}<strong>{notice.title}</strong><small>{formatDate(notice.publishedAt, locale)}</small></span><ArrowRight /></Link>)}</div>}
          </TabSection>}

          {activeTab === "live" && <TabSection title={t.liveHeading} help={t.liveHelp}>
            {liveState.status !== "ready"
              ? liveState.status === "error" ? <ErrorState text={t.noLiveHelp} /> : <Loading locale={locale} />
              : liveState.data.length === 0 ? <Empty title={t.noLive} help={t.noLiveHelp} />
              : <div className={styles.liveList}>{liveState.data.map((live: LiveItem) => <div key={live.slug} className={styles.liveSection}><div className={styles.liveCopy}><p><Radio /> {live.effectiveStatus}</p><h3>{live.title}</h3><span><Clock /> {formatDate(live.startsAt, locale)}</span></div><Link className={styles.liveAction} href={`/live/${live.slug}${localeQuery}`}><span><Play /> {t.liveDetails}</span><ArrowRight /></Link></div>)}</div>}
          </TabSection>}

          {activeTab === "benefits" && <TabSection title={t.benefitHeading} help={t.benefitHelp} action={<Link href={`/benefits?locale=${locale}&celebrity=${celebrity.slug}`}>{t.allBenefits}<ArrowRight /></Link>}>
            {benefitState.status !== "ready"
              ? benefitState.status === "error" ? <ErrorState text={t.benefitError} /> : <Loading locale={locale} />
              : benefitState.data.length === 0 ? <Empty title={t.noBenefits} help={t.noNoticeHelp} />
              : <div className={styles.benefitGrid}>{benefitState.data.map((benefit: Benefit) => <Link key={benefit.id} href={`/benefits/${benefit.id}?locale=${locale}&celebrity=${celebrity.slug}`}><span>{benefit.state}</span><h3>{benefit.title}</h3><p>{benefit.summary}</p><small>{benefit.eligibilityLabel}</small><ArrowRight /></Link>)}</div>}
          </TabSection>}
        </section>
      </FanContentContainer>
    </FanAppFrame>
  );
}

function TabSection({ title, help, action, children }: { title: string; help: string; action?: ReactNode; children: ReactNode }) {
  return <section className={styles.contentSection}><div className={styles.sectionHeading}><div><h2>{title}</h2><p>{help}</p></div>{action}</div>{children}</section>;
}
function Loading({ locale }: { locale: ContentLocale }) { return <div className={styles.inlineEmpty} role="status">{locale === "ko" ? "불러오는 중이에요." : "Loading."}</div>; }
function ErrorState({ text }: { text: string }) { return <div className={styles.inlineEmpty} role="alert"><strong>{text}</strong></div>; }
function Empty({ title, help }: { title: string; help: string }) { return <div className={styles.inlineEmpty} role="status"><strong>{title}</strong><span>{help}</span></div>; }
