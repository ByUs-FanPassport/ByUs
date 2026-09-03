"use client";

import { usePrivy } from "@privy-io/react-auth";
import Image, { getImageProps } from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  pageViewIdempotencyKey,
  recordProductEventV1,
} from "@/features/analytics/client/product-event-client";
import type { Route } from "next";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowRight, Clock, Play, Radio } from "./icons";
import { AuthIntentLink } from "./auth-intent-link";
import { FanAppFrame, FanContentContainer } from "./fan-shell/fan-app-shell";
import { FanAction } from "./fan-ui/fan-action";
import type { LiveEventResponse } from "../features/live/domain/live-event";
import {
  parsePassportCollectionResponse,
  type PassportCollectionResponse,
} from "../features/passport/domain/passport-collection";
import type { ContentLocale, PublishedCelebrity, PublishedCelebrityLive } from "../server/content/content-domain";
import katseyeHeroDesktop from "../public/images/celebrities/katseye/hero-desktop.webp";
import katseyeHeroMobile from "../public/images/celebrities/katseye/hero-mobile.webp";
import katseyeProfile from "../public/images/celebrities/katseye/profile.webp";
import styles from "./celebrity-fan-page.module.css";
import { ReactionAction } from "../features/reaction/ui/reaction-action";

export type CelebrityFanTab = "home" | "notice" | "live" | "benefits";
type OwnedPassport = PassportCollectionResponse["passports"][number];
type PassportState =
  | Readonly<{ status: "guest" | "loading" | "none" }>
  | Readonly<{ status: "owned"; passport: OwnedPassport }>
  | Readonly<{ status: "error" }>;
type AsyncState<T> =
  | Readonly<{ status: "idle" | "loading" }>
  | Readonly<{ status: "ready"; data: T }>
  | Readonly<{ status: "error" }>;
type Notice = Readonly<{ slug: string; title: string; pinned: boolean; publishedAt: string }>;
type Benefit = Readonly<{ id: string; title: string; summary: string; eligibilityLabel: string; state: string }>;

const tabs: CelebrityFanTab[] = ["home", "notice", "live", "benefits"];
const socialLabel = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram" } as const;
const copy = {
  ko: {
    official: "BYUS FAN PAGE", openPassport: "Passport 열기", passportError: "Passport 상태를 확인하지 못했어요.",
    retry: "다시 시도", checking: "Passport 상태 확인 중", verify: "팬 인증하기", sections: "팬페이지 메뉴",
    tabs: { home: "홈", notice: "공지", live: "LIVE", benefits: "혜택" },
    noNotice: "등록된 공지가 아직 없어요.", noNoticeHelp: "새 소식이 공개되면 이곳에서 확인할 수 있어요.",
    noticeError: "공지를 불러오지 못했어요.", pinned: "고정", latestNotice: "최근 공지", allNotices: "전체 공지 보기",
    latestNoticeHelp: (name: string) => `ByUs가 전하는 ${name}의 최신 소식이에요.`,
    liveHeading: "LIVE", liveHelp: "공개된 LIVE와 다시보기를 확인하세요.", homeLiveHelp: "가장 가까운 LIVE 일정을 확인하세요.",
    liveDetails: "LIVE 자세히 보기", noLive: "공개된 LIVE가 아직 없어요.", noLiveHelp: "새로운 일정이 공개되면 이곳에 표시돼요.",
    benefitHeading: "혜택", fanBenefits: "팬 혜택", benefitHelp: "함께한 활동으로 열리는 혜택을 확인하세요.",
    homeBenefitHelp: "팬 활동으로 열리는 혜택을 미리 확인하세요.", benefitError: "혜택을 불러오지 못했어요.",
    noBenefits: "공개된 혜택이 아직 없어요.", noBenefitsHelp: "새 혜택이 공개되면 이곳에서 확인할 수 있어요.", allBenefits: "전체 혜택 보기",
    myPassport: "내 Fan Passport", beforeVerification: "팬 인증 전",
    beforeVerificationHelp: (name: string) => `${name} 팬 인증을 완료하면 Passport에 활동 기록이 쌓여요.`,
    passportDetails: "Passport 상세 보기", level: "등급", score: "팬 점수", stamps: "Stamp", profile: "Profile",
    profileHelp: (name: string) => `${name}의 공개 채널을 확인하세요.`,
    officialSns: "채널", newWindow: "새 창",
    noSns: "공개된 채널 링크가 아직 없어요.", noSnsHelp: "채널이 등록되면 이곳에 표시돼요.", nextLive: "다음 LIVE",
  },
  en: {
    official: "BYUS FAN PAGE", openPassport: "Open Passport", passportError: "We couldn't check your Passport status.",
    retry: "Try again", checking: "Checking Passport status", verify: "Verify fandom", sections: "fan page menu",
    tabs: { home: "Home", notice: "Notice", live: "LIVE", benefits: "Benefits" },
    noNotice: "No Notice has been published yet.", noNoticeHelp: "New updates from ByUs will appear here.",
    noticeError: "We couldn't load Notices.", pinned: "Pinned", latestNotice: "Latest notices", allNotices: "View all notices",
    latestNoticeHelp: (name: string) => `See the latest ${name} updates from ByUs.`,
    liveHeading: "LIVE", liveHelp: "Explore published LIVE events and replays.", homeLiveHelp: "See the nearest upcoming LIVE schedule.",
    liveDetails: "View LIVE details", noLive: "No LIVE has been published yet.", noLiveHelp: "New schedules will appear here.",
    benefitHeading: "Benefits", fanBenefits: "Fan benefits", benefitHelp: "Discover benefits unlocked by your fan activities.",
    homeBenefitHelp: "Preview benefits unlocked by fan activities.", benefitError: "We couldn't load benefits.",
    noBenefits: "No benefit has been published yet.", noBenefitsHelp: "New benefits will appear here.", allBenefits: "View all benefits",
    myPassport: "My Fan Passport", beforeVerification: "Before fan verification",
    beforeVerificationHelp: (name: string) => `Complete ${name} fan verification to start recording activity in your Passport.`,
    passportDetails: "View Passport details", level: "Level", score: "Fan Score", stamps: "Stamps", profile: "Profile",
    profileHelp: (name: string) => `Explore ${name}'s published channels.`,
    officialSns: "Channels", newWindow: "new window",
    noSns: "No channel links are published yet.", noSnsHelp: "Channels will appear here.", nextLive: "Next LIVE",
  },
} as const;

function formatDate(value: string, locale: ContentLocale) {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    dateStyle: "medium", timeStyle: "short", hour12: locale !== "ko", timeZone: "Asia/Seoul",
  }).format(new Date(value));
}
function findOwnedPassport(value: unknown, slug: string): OwnedPassport | null {
  return parsePassportCollectionResponse(value).passports.find((item) => item.celebrity.slug === slug) ?? null;
}

function isLiveEventResponse(item: unknown): item is LiveEventResponse {
  return Boolean(
    item
    && typeof item === "object"
    && "live" in item
    && item.live
    && typeof item.live === "object"
    && "slug" in item.live
    && typeof item.live.slug === "string"
    && "celebrity" in item.live
    && item.live.celebrity
    && typeof item.live.celebrity === "object"
    && "slug" in item.live.celebrity
    && typeof item.live.celebrity.slug === "string"
  );
}

export function flattenLiveCatalog(value: unknown): LiveEventResponse[] {
  if (!value || typeof value !== "object") return [];
  const catalog = value as Record<string, unknown>;
  return ["liveNow", "upcoming", "replay"]
    .flatMap((key) => Array.isArray(catalog[key]) ? catalog[key] : [])
    .filter(isLiveEventResponse);
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
  const [liveState, setLiveState] = useState<AsyncState<LiveEventResponse[]>>({ status: "idle" });
  const [benefitState, setBenefitState] = useState<AsyncState<Benefit[]>>({ status: "idle" });
  const activeTab = initialTab ?? "home";
  const hasKatseyePresentation = celebrity.slug === "katseye";

  useEffect(() => {
    if (!ready) return;
    void (async () => {
      const token = authenticated ? await getAccessToken() : null;
      await recordProductEventV1(
        {
          eventName: "creator_page_view",
          celebrityId: null,
          liveEventId: null,
          missionId: null,
          benefitId: null,
          source: "fan.creator.detail",
          idempotencyKey: pageViewIdempotencyKey(
            "creator_page_view",
            `/c/${celebrity.slug}`,
          ),
          properties: { celebritySlug: celebrity.slug },
        },
        token,
      );
    })();
  }, [authenticated, celebrity.slug, getAccessToken, ready]);

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
        const passport = findOwnedPassport(await response.json(), celebrity.slug);
        setPassportState(passport ? { status: "owned", passport } : { status: "none" });
      } catch { if (!controller.signal.aborted) setPassportState({ status: "error" }); }
    })();
    return () => controller.abort();
  }, [authenticated, celebrity.slug, getAccessToken, locale, ready, requestKey]);

  useEffect(() => {
    if ((activeTab === "home" || activeTab === "notice") && noticeState.status === "idle") {
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
        .then((payload) => setLiveState({
          status: "ready",
          data: flattenLiveCatalog(payload.catalog).filter(
            ({ live }) => live.celebrity.slug === celebrity.slug,
          ),
        }))
        .catch(() => setLiveState({ status: "error" }));
    }
    if ((activeTab === "home" || activeTab === "benefits") && benefitState.status === "idle") {
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
  const katseyeHero = hasKatseyePresentation
    ? {
        desktop: getImageProps({
          src: katseyeHeroDesktop,
          alt: celebrity.image.alt,
          fill: true,
          sizes: "(min-width: 1024px) 1360px, calc(100vw - 64px)",
          priority: true,
          placeholder: typeof katseyeHeroDesktop === "object" ? "blur" : "empty",
        }).props,
        mobile: getImageProps({
          src: katseyeHeroMobile,
          alt: celebrity.image.alt,
          fill: true,
          sizes: "(max-width: 767px) calc(100vw - 32px), calc(100vw - 64px)",
          priority: true,
          placeholder: typeof katseyeHeroMobile === "object" ? "blur" : "empty",
        }).props,
      }
    : null;

  return (
    <FanAppFrame locale={locale} mainId="celebrity-detail-main">
      <FanContentContainer as="main" id="celebrity-detail-main" className={styles.page} tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="celebrity-heading">
          {katseyeHero ? (
            <picture className={styles.heroPicture}>
              <source
                media="(min-width: 48rem)"
                srcSet={katseyeHero.desktop.srcSet}
                sizes={katseyeHero.desktop.sizes}
              />
              {/* next/image getImageProps keeps both art-directed sources optimized. */}
              {/* impeccable-disable-next-line broken-image: src is provided by getImageProps */}
              <img {...katseyeHero.mobile} alt={celebrity.image.alt} />
            </picture>
          ) : (
            <Image src={celebrity.image.url} alt={celebrity.image.alt} fill sizes="(min-width: 1024px) 1360px, 100vw" priority style={{ objectPosition: celebrity.image.position }} unoptimized={celebrity.image.url.startsWith("https://")} />
          )}
          <div className={styles.scrim} aria-hidden="true" />
          <div className={styles.heroCopy}><p>{t.official}</p><h1 id="celebrity-heading">{celebrity.name}</h1><span>{celebrity.summary}</span></div>
          <div className={styles.heroAction}>
            {passportState.status === "owned" ? <Link data-fan-action-emphasis="primary" href={`/passports/${passportState.passport.id}${localeQuery}`}><span>{t.openPassport}</span><ArrowRight /></Link>
              : passportState.status === "error" ? <div className={styles.ctaError} role="alert"><span>{t.passportError}</span><button type="button" onClick={() => setRequestKey((key) => key + 1)}>{t.retry}</button></div>
              : passportState.status === "loading" ? <span className={styles.ctaLoading} role="status">{t.checking}</span>
              : <AuthIntentLink emphasis="primary" focusKey="celebrity-hero-verification" locale={locale} input={{ sourcePath: `/c/${celebrity.slug}/verify`, sourceQuery: `?tab=${activeTab}&locale=${locale}`, actionType: "START_FAN_VERIFICATION", targetType: "celebrity", targetId: celebrity.slug }}><span>{t.verify}</span><ArrowRight /></AuthIntentLink>}
          </div>
        </section>

        <nav className={styles.sectionNav} aria-label={`${celebrity.name} ${t.sections}`} role="tablist">
          {tabs.map((tab, index) => <Link key={tab} href={tabHref(tab)} role="tab" aria-selected={activeTab === tab} aria-controls={`celebrity-${tab}-panel`} tabIndex={activeTab === tab ? 0 : -1} onKeyDown={(event) => tabKeyDown(event, index)}>{t.tabs[tab]}</Link>)}
        </nav>

        {activeTab === "home" && <ReactionAction slug={celebrity.slug} locale={locale} />}

        <section id={`celebrity-${activeTab}-panel`} role="tabpanel" className={styles.tabPanel}>
          {activeTab === "home" && <div className={styles.hubLayout}>
            <div className={styles.mainColumn}>
              <TabSection
                title={t.latestNotice}
                help={t.latestNoticeHelp(celebrity.name)}
                action={<Link href={tabHref("notice")}>{t.allNotices}<ArrowRight /></Link>}
              >
                <NoticeContent
                  state={noticeState}
                  celebritySlug={celebrity.slug}
                  locale={locale}
                  limit={2}
                  copy={{ error: t.noticeError, empty: t.noNotice, emptyHelp: t.noNoticeHelp, pinned: t.pinned }}
                />
              </TabSection>

              <TabSection title={t.nextLive} help={t.homeLiveHelp}>
                {upcomingLive
                  ? <div className={styles.liveSection}>
                      <div className={styles.liveCopy}>
                        <p><Radio />{upcomingLive.effectiveStatus}</p>
                        <h3>{upcomingLive.title}</h3>
                        <span><Clock />{formatDate(upcomingLive.startsAt, locale)}</span>
                      </div>
                      <FanAction variant="neutral" href={`/live/${upcomingLive.slug}${localeQuery}`} leadingIcon={<Play />} trailingIcon={<ArrowRight />}>{t.liveDetails}</FanAction>
                    </div>
                  : <Empty title={t.noLive} help={t.noLiveHelp} />}
              </TabSection>

              <TabSection
                title={t.fanBenefits}
                help={t.homeBenefitHelp}
                action={<Link href={`/benefits?locale=${locale}&celebrity=${celebrity.slug}`}>{t.allBenefits}<ArrowRight /></Link>}
              >
                <BenefitContent
                  state={benefitState}
                  celebritySlug={celebrity.slug}
                  locale={locale}
                  limit={2}
                  className={styles.homeBenefitGrid}
                  copy={{ error: t.benefitError, empty: t.noBenefits, emptyHelp: t.noBenefitsHelp }}
                />
              </TabSection>
            </div>
            <div className={styles.homeAside}>
              <section className={styles.passportSummary} aria-labelledby="passport-summary-title">
                <h2 id="passport-summary-title">{t.myPassport}</h2>
                <PassportSummary
                  state={passportState}
                  celebrityName={celebrity.name}
                  localeQuery={localeQuery}
                  labels={{
                    checking: t.checking,
                    error: t.passportError,
                    retry: t.retry,
                    beforeVerification: t.beforeVerification,
                    beforeVerificationHelp: t.beforeVerificationHelp(celebrity.name),
                    level: t.level,
                    score: t.score,
                    stamps: t.stamps,
                    details: t.passportDetails,
                  }}
                  onRetry={() => setRequestKey((key) => key + 1)}
                />
              </section>
              <section className={styles.profilePanel} aria-labelledby="profile-title">
                <div className={styles.profilePortrait}><Image src={hasKatseyePresentation ? katseyeProfile : celebrity.image.url} alt="" width={144} height={144} style={{ objectPosition: celebrity.image.position }} unoptimized={!hasKatseyePresentation && celebrity.image.url.startsWith("https://")} /></div>
                <h2 id="profile-title">{celebrity.name} {t.profile}</h2><p>{t.profileHelp(celebrity.name)}</p>
                {celebrity.socialLinks.length ? <div className={styles.socialLinks} role="group" aria-label={`${celebrity.name} ${t.officialSns}`}>{celebrity.socialLinks.map((social) => <a key={social.platform} href={social.url} target="_blank" rel="noreferrer" aria-label={`${socialLabel[social.platform]} ${locale === "ko" ? "열기" : "open"}: ${celebrity.name}, ${t.newWindow}`}><Image src={`/images/guest-home/${social.platform}.svg`} alt="" width={20} height={20} /><span>{socialLabel[social.platform]}</span></a>)}</div> : <div className={styles.socialEmpty} role="status"><strong>{t.noSns}</strong><span>{t.noSnsHelp}</span></div>}
              </section>
            </div>
          </div>}

          {activeTab === "notice" && <TabSection title={t.tabs.notice} help={locale === "ko" ? `ByUs가 전하는 ${celebrity.name} 소식을 확인하세요.` : `Explore ${celebrity.name} updates from ByUs.`}>
            <NoticeContent
              state={noticeState}
              celebritySlug={celebrity.slug}
              locale={locale}
              copy={{ error: t.noticeError, empty: t.noNotice, emptyHelp: t.noNoticeHelp, pinned: t.pinned }}
            />
          </TabSection>}

          {activeTab === "live" && <TabSection title={t.liveHeading} help={t.liveHelp}>
            {liveState.status !== "ready"
              ? liveState.status === "error" ? <ErrorState text={t.noLiveHelp} /> : <Loading locale={locale} />
              : liveState.data.length === 0 ? <Empty title={t.noLive} help={t.noLiveHelp} />
              : <div className={styles.liveList}>{liveState.data.map(({ live }) => <div key={live.slug} className={styles.liveSection}><div className={styles.liveCopy}><p><Radio /> {live.effectiveStatus}</p><h3>{live.title}</h3><span><Clock /> {formatDate(live.startsAt, locale)}</span></div><FanAction variant="neutral" href={`/live/${live.slug}${localeQuery}`} leadingIcon={<Play />} trailingIcon={<ArrowRight />}>{t.liveDetails}</FanAction></div>)}</div>}
          </TabSection>}

          {activeTab === "benefits" && <TabSection title={t.benefitHeading} help={t.benefitHelp} action={<Link href={`/benefits?locale=${locale}&celebrity=${celebrity.slug}`}>{t.allBenefits}<ArrowRight /></Link>}>
            <BenefitContent
              state={benefitState}
              celebritySlug={celebrity.slug}
              locale={locale}
              copy={{ error: t.benefitError, empty: t.noBenefits, emptyHelp: t.noBenefitsHelp }}
            />
          </TabSection>}
        </section>
      </FanContentContainer>
    </FanAppFrame>
  );
}

function TabSection({ title, help, action, children }: { title: string; help: string; action?: ReactNode; children: ReactNode }) {
  return <section className={styles.contentSection}><div className={styles.sectionHeading}><div><h2>{title}</h2><p>{help}</p></div>{action}</div>{children}</section>;
}

function NoticeContent({
  state, celebritySlug, locale, limit, copy: labels,
}: {
  state: AsyncState<Notice[]>;
  celebritySlug: string;
  locale: ContentLocale;
  limit?: number;
  copy: Readonly<{ error: string; empty: string; emptyHelp: string; pinned: string }>;
}) {
  if (state.status !== "ready") return state.status === "error" ? <ErrorState text={labels.error} /> : <Loading locale={locale} />;
  if (state.data.length === 0) return <Empty title={labels.empty} help={labels.emptyHelp} />;
  const notices = limit ? state.data.slice(0, limit) : state.data;
  return <div className={styles.noticeList}>{notices.map((notice) => (
    <Link key={notice.slug} href={`/c/${celebritySlug}/notices/${notice.slug}?locale=${locale}`}>
      <span>{notice.pinned && <em>{labels.pinned}</em>}<strong>{notice.title}</strong><small>{formatDate(notice.publishedAt, locale)}</small></span>
      <ArrowRight />
    </Link>
  ))}</div>;
}

function BenefitContent({
  state, celebritySlug, locale, limit, className, copy: labels,
}: {
  state: AsyncState<Benefit[]>;
  celebritySlug: string;
  locale: ContentLocale;
  limit?: number;
  className?: string;
  copy: Readonly<{ error: string; empty: string; emptyHelp: string }>;
}) {
  if (state.status !== "ready") return state.status === "error" ? <ErrorState text={labels.error} /> : <Loading locale={locale} />;
  if (state.data.length === 0) return <Empty title={labels.empty} help={labels.emptyHelp} />;
  const benefits = limit ? state.data.slice(0, limit) : state.data;
  return <div className={`${styles.benefitGrid} ${className ?? ""}`.trim()}>{benefits.map((benefit) => (
    <Link key={benefit.id} href={`/benefits/${benefit.id}?locale=${locale}&celebrity=${celebritySlug}`}>
      <span>{benefit.state}</span><h3>{benefit.title}</h3><p>{benefit.summary}</p><small>{benefit.eligibilityLabel}</small><ArrowRight />
    </Link>
  ))}</div>;
}

function PassportSummary({
  state, celebrityName, localeQuery, labels, onRetry,
}: {
  state: PassportState;
  celebrityName: string;
  localeQuery: string;
  labels: Readonly<{
    checking: string;
    error: string;
    retry: string;
    beforeVerification: string;
    beforeVerificationHelp: string;
    level: string;
    score: string;
    stamps: string;
    details: string;
  }>;
  onRetry: () => void;
}) {
  if (state.status === "loading") return <div className={styles.passportStatus} role="status">{labels.checking}</div>;
  if (state.status === "error") {
    return <div className={styles.passportError} role="alert"><strong>{labels.error}</strong><button type="button" onClick={onRetry}>{labels.retry}</button></div>;
  }
  if (state.status !== "owned") {
    return <div className={styles.passportStatus}><strong>{labels.beforeVerification}</strong><p>{labels.beforeVerificationHelp}</p></div>;
  }
  const { passport } = state;
  return <>
    <div className={styles.passportStatus}>
      <span>{passport.display.mintStatus}</span>
      <strong>{celebrityName} Fan Passport</strong>
    </div>
    <dl className={styles.passportFacts}>
      <div><dt>{labels.level}</dt><dd>{passport.display.level}</dd></div>
      <div><dt>{labels.score}</dt><dd>{passport.score.points}</dd></div>
      <div><dt>{labels.stamps}</dt><dd>{passport.stampSummary.total}</dd></div>
    </dl>
    <Link className={styles.passportTextLink} href={`/passports/${passport.id}${localeQuery}`}>{labels.details}<ArrowRight /></Link>
  </>;
}

function Loading({ locale }: { locale: ContentLocale }) { return <div className={styles.inlineEmpty} role="status">{locale === "ko" ? "불러오는 중이에요." : "Loading."}</div>; }
function ErrorState({ text }: { text: string }) { return <div className={styles.inlineEmpty} role="alert"><strong>{text}</strong></div>; }
function Empty({ title, help }: { title: string; help: string }) { return <div className={styles.inlineEmpty} role="status"><strong>{title}</strong><span>{help}</span></div>; }
