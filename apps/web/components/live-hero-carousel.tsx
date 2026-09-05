"use client";

import Image, { getImageProps } from "next/image";
import Link from "next/link";
import type { Route } from "next";
import useEmblaCarousel from "embla-carousel-react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveEventResponse } from "../features/live/domain/live-event";
import type { ContentLocale } from "../server/content/content-domain";
import { AuthIntentLink } from "./auth-intent-link";
import { ArrowRight, ChevronLeft, ChevronRight, Clock, Play, Radio } from "./icons";
import styles from "./guest-home.module.css";
import { creatorHeroImages } from "./fan-ui/creator-hero-images";

const AUTOPLAY_INTERVAL_MS = 6_000;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const BANKSY_CAMPAIGN_IMAGE = "/images/guest-home/banksy-exhibition-campaign.webp";

const carouselCopy = {
  ko: {
    label: "주요 LIVE",
    previous: "이전 LIVE",
    next: "다음 LIVE",
    goTo: (index: number) => `${index}번째 LIVE 보기`,
    position: (index: number, total: number) => `${index} / ${total}`,
    reserve: "라이브 예약하기",
    enter: "라이브 입장하기",
    details: "LIVE 상세보기",
    noneStatus: "공개된 LIVE 없음",
    noneTitle: "새로운 LIVE를 준비하고 있어요.",
    campaignStatus: "SPECIAL EXHIBITION",
    campaignDate: "9월 18일 금요일 · 오후 5시",
    campaignTitle: "엘리나와 함께 만나는 뱅크시",
    campaignPeriod: "11월 전시 종료까지",
    campaignAction: "이벤트 살펴보기",
    campaignAlt: "어두운 콘크리트 공간에 스트리트아트 작품이 전시된 현대 미술관",
  },
  en: {
    label: "Featured LIVE events",
    previous: "Previous LIVE",
    next: "Next LIVE",
    goTo: (index: number) => `View LIVE ${index}`,
    position: (index: number, total: number) => `${index} of ${total}`,
    reserve: "Reserve LIVE",
    enter: "Enter LIVE",
    details: "View LIVE details",
    noneStatus: "No published LIVE",
    noneTitle: "A new LIVE is in preparation.",
    campaignStatus: "SPECIAL EXHIBITION",
    campaignDate: "Friday, September 18 · 5:00 PM",
    campaignTitle: "Meet Banksy with Elina",
    campaignPeriod: "Through the exhibition's November close",
    campaignAction: "Explore the event",
    campaignAlt: "A contemporary museum with street-art works displayed in a dark concrete gallery",
  },
} as const;

function formatKoreanLiveDate(value: string) {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error("Invalid LIVE timestamp");
  const kst = new Date(instant.getTime() + 9 * 60 * 60 * 1000);
  const hour = kst.getUTCHours();
  const period = hour < 12 ? "오전" : "오후";
  const displayHour = hour % 12 || 12;
  return `${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일 ${period} ${displayHour}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
}

function formatLiveDate(value: string, locale: ContentLocale) {
  if (locale === "ko") return formatKoreanLiveDate(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

export function formatLiveCountdown(startsAt: string, now: number) {
  const remainingSeconds = Math.max(0, Math.floor((Date.parse(startsAt) - now) / 1_000));
  if (remainingSeconds === 0) return "LIVE NOW";
  const days = Math.floor(remainingSeconds / 86_400);
  const hours = Math.floor((remainingSeconds % 86_400) / 3_600);
  const minutes = Math.floor((remainingSeconds % 3_600) / 60);
  const seconds = remainingSeconds % 60;
  const clock = [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  return days > 0 ? `D-${days} ${clock}` : clock;
}

export function formatHeroLiveTitle(celebrityName: string) {
  return `${celebrityName} LIVE`;
}

function LiveCountdown({
  effectiveStatus,
  startsAt,
}: {
  effectiveStatus: LiveEventResponse["live"]["effectiveStatus"];
  startsAt: string;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const value = effectiveStatus === "live"
    ? "LIVE NOW"
    : now === null
      ? "--:--:--"
      : formatLiveCountdown(startsAt, now);

  return <span aria-live="off">{value}</span>;
}

export function LiveHeroCarousel({
  featuredLives,
  locale,
}: {
  featuredLives: readonly LiveEventResponse[];
  locale: ContentLocale;
}) {
  const t = carouselCopy[locale];
  const total = featuredLives.length + 1;
  const hasControls = total > 1;
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [interactionPaused, setInteractionPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [timerRevision, setTimerRevision] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const [viewportRef, emblaApi] = useEmblaCarousel({
    loop: hasControls,
    duration: 24,
    watchDrag: hasControls && !reducedMotion,
  });

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    const syncPreference = () => setReducedMotion(media.matches);
    syncPreference();
    media.addEventListener("change", syncPreference);
    return () => media.removeEventListener("change", syncPreference);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    let inView = false;
    const syncVisibility = () => {
      root.dataset.motionVisible = String(inView && !document.hidden);
    };
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      syncVisibility();
    });
    observer.observe(root);
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);

  useEffect(() => {
    if (!emblaApi) return;
    const syncActiveIndex = () => setActiveIndex(emblaApi.selectedScrollSnap());
    syncActiveIndex();
    emblaApi.on("select", syncActiveIndex);
    emblaApi.on("reInit", syncActiveIndex);
    return () => {
      emblaApi.off("select", syncActiveIndex);
      emblaApi.off("reInit", syncActiveIndex);
    };
  }, [emblaApi]);

  useEffect(() => {
    if (activeIndex < total) return;
    emblaApi?.scrollTo(0, true);
    setActiveIndex(0);
  }, [activeIndex, emblaApi, total]);

  const goTo = useCallback((index: number, manual: boolean) => {
    if (total < 1) return;
    const nextIndex = (index + total) % total;
    if (emblaApi) emblaApi.scrollTo(nextIndex, reducedMotion);
    else setActiveIndex(nextIndex);
    if (manual) {
      setTimerRevision((value) => value + 1);
      setAnnouncement(t.position(nextIndex + 1, total));
    }
  }, [emblaApi, reducedMotion, t, total]);

  useEffect(() => {
    if (total <= 1 || interactionPaused || reducedMotion) return;
    const timer = window.setTimeout(() => goTo(activeIndex + 1, false), AUTOPLAY_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [activeIndex, goTo, interactionPaused, reducedMotion, timerRevision, total]);

  return (
    <div
      className={styles.heroCarousel}
      ref={rootRef}
      role="region"
      aria-roledescription="carousel"
      aria-label={t.label}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      data-has-controls={hasControls ? "true" : "false"}
      onMouseEnter={() => setInteractionPaused(true)}
      onMouseLeave={() => setInteractionPaused(false)}
      onFocusCapture={() => setInteractionPaused(true)}
      onBlurCapture={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
          setInteractionPaused(false);
        }
      }}
      onPointerDown={() => setInteractionPaused(true)}
      onPointerUp={() => setInteractionPaused(false)}
      onPointerCancel={() => setInteractionPaused(false)}
    >
      <div className={styles.heroViewport} ref={viewportRef}>
        <div className={styles.heroTrack}>
          {featuredLives.map((featuredLive, index) => {
          const isActive = index === activeIndex;
          const creatorHero = featuredLive.live.celebrity.slug === "elina" ? creatorHeroImages.elina : undefined;
          const creatorPicture = creatorHero ? {
            desktop: getImageProps({ src: creatorHero.src, alt: featuredLive.live.heroImage.alt, fill: true, sizes: "100vw", priority: index === 0 }).props,
            mobile: getImageProps({ src: creatorHero.mobileSrc ?? creatorHero.src, alt: featuredLive.live.heroImage.alt, fill: true, sizes: "100vw", priority: index === 0 }).props,
          } : null;
          const detailHref = `/live/${featuredLive.live.slug}`;
          const statusLabel = featuredLive.live.effectiveStatus === "live" ? "LIVE" : "UPCOMING";
          const heroActionLabel =
            featuredLive.primaryAction === "watch_live"
              ? t.enter
              : featuredLive.primaryAction === "sign_in_to_reserve"
                ? t.reserve
                : t.details;

            return (
              <article
              className={styles.heroCard}
              key={featuredLive.live.slug}
              aria-hidden={!isActive}
              aria-roledescription="slide"
              aria-label={t.position(index + 1, total)}
              inert={!isActive}
              data-active={isActive ? "true" : "false"}
              style={creatorHero ? { "--creator-hero-desktop-position": creatorHero.desktopPosition, "--creator-hero-mobile-position": creatorHero.mobilePosition } as CSSProperties : undefined}
            >
              {creatorPicture ? <picture className={styles.heroCreatorPicture}>
                <source media="(min-width: 48rem)" srcSet={creatorPicture.desktop.srcSet} sizes={creatorPicture.desktop.sizes} />
                <img {...creatorPicture.mobile} alt={featuredLive.live.heroImage.alt} />
              </picture> : <Image
                src={featuredLive.live.heroImage.url}
                alt={featuredLive.live.heroImage.alt}
                fill
                unoptimized={featuredLive.live.heroImage.url.startsWith("https://")}
                sizes="(min-width: 1024px) 66vw, 100vw"
                priority={index === 0}
              />}
              <div className={styles.heroOverlay} aria-hidden="true" />
              <div className={styles.heroContent}>
                <div className={styles.statusRail}>
                  <p className={styles.liveStatus} data-upcoming={statusLabel === "UPCOMING" ? "true" : undefined}>
                    {statusLabel === "UPCOMING" && <span className={styles.statusShimmer} aria-hidden="true">
                      <span className={styles.statusShimmerSlide}><span className={styles.statusShimmerLight} /></span>
                    </span>}
                    <Radio /> <span className={styles.statusText}>{statusLabel}</span>
                  </p>
                  <p className={styles.heroDate}>{formatLiveDate(featuredLive.live.startsAt, locale)}</p>
                </div>
                <h2>{formatHeroLiveTitle(featuredLive.live.celebrity.name)}</h2>
                <p className={styles.heroCountdown}>
                  <Clock />
                  <LiveCountdown
                    effectiveStatus={featuredLive.live.effectiveStatus}
                    startsAt={featuredLive.live.startsAt}
                  />
                </p>
                {featuredLive.primaryAction === "sign_in_to_reserve" ? (
                  <AuthIntentLink
                    className={styles.primaryButton}
                    emphasis="primary"
                    locale={locale}
                    pendingHref={`${detailHref}?locale=${locale}`}
                    input={{
                      sourcePath: detailHref,
                      sourceQuery: `?locale=${locale}`,
                      actionType: "RESERVE_LIVE",
                      targetType: "live_event",
                      targetId: featuredLive.live.slug,
                    }}
                  >
                    <span><Play />{heroActionLabel}</span><ArrowRight />
                  </AuthIntentLink>
                ) : (
                  <Link data-fan-action-emphasis="primary" className={styles.primaryButton} href={`${detailHref}?locale=${locale}` as Route}>
                    <span><Play />{heroActionLabel}</span><ArrowRight />
                  </Link>
                )}
              </div>
              </article>
            );
          })}
          <article
            className={`${styles.heroCard} ${styles.campaignHeroCard}`}
            aria-hidden={activeIndex !== featuredLives.length}
            aria-roledescription="slide"
            aria-label={t.position(total, total)}
            inert={activeIndex !== featuredLives.length}
            data-active={activeIndex === featuredLives.length ? "true" : "false"}
          >
            <Image
              src={BANKSY_CAMPAIGN_IMAGE}
              alt={t.campaignAlt}
              fill
              sizes="(min-width: 1024px) 66vw, 100vw"
              priority={featuredLives.length === 0}
            />
            <div className={styles.heroOverlay} aria-hidden="true" />
            <div className={styles.heroContent}>
              <div className={styles.statusRail}>
                <p className={styles.liveStatus}>{t.campaignStatus}</p>
                <p className={styles.heroDate}>{t.campaignDate}</p>
              </div>
              <h2>{t.campaignTitle}</h2>
              <p className={styles.campaignHeroPeriod}>{t.campaignPeriod}</p>
              <Link data-fan-action-emphasis="primary" className={styles.primaryButton} href={`/c/elina?locale=${locale}` as Route}>
                <span>{t.campaignAction}</span><ArrowRight />
              </Link>
            </div>
          </article>
        </div>
      </div>

      {hasControls ? (
        <div className={styles.carouselControls}>
          <button className={styles.carouselPrevious} type="button" aria-label={t.previous} onClick={() => goTo(activeIndex - 1, true)}>
            <ChevronLeft />
          </button>
          <div
            className={styles.carouselDots}
            style={{ "--carousel-width": `${total * 32}px` } as CSSProperties}
          >
            {[...featuredLives.map((featuredLive) => featuredLive.live.slug), "banksy-campaign"].map((key, index) => (
              <button
                type="button"
                className={styles.carouselDot}
                aria-label={t.goTo(index + 1)}
                aria-current={index === activeIndex ? "true" : undefined}
                onClick={() => goTo(index, true)}
                key={key}
              >
                <span aria-hidden="true" />
              </button>
            ))}
          </div>
          <button className={styles.carouselNext} type="button" aria-label={t.next} onClick={() => goTo(activeIndex + 1, true)}>
            <ChevronRight />
          </button>
        </div>
      ) : null}
      <p className={styles.carouselAnnouncement} aria-live="polite" aria-atomic="true">{announcement}</p>
    </div>
  );
}
