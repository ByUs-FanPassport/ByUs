"use client";

import Link from "next/link";
import type { Route } from "next";
import useEmblaCarousel from "embla-carousel-react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveEventResponse } from "../features/live/domain/live-event";
import type { ContentLocale, PublishedCelebrity } from "../server/content/content-domain";
import { AuthIntentLink } from "./auth-intent-link";
import { Pause } from "lucide-react";
import { ArrowRight, ChevronLeft, ChevronRight, Play, Radio } from "./icons";
import styles from "./guest-home.module.css";
import { ElinaGuideCard } from "./home-entry-cards/home-entry-cards";
import { EventPhoto } from "./fan-ui/event-photo";
import { homeHeroSizes } from "./fan-ui/public-image-policy";
import { CreatorImage } from "./fan-ui/creator-image";
import { HomeHeroBanner } from "./home-entry-cards/home-hero-banner";
import { formatDetailedLiveCountdown, type LiveStartEvent } from "@/features/live/domain/live-time-display";
import { useLiveStartClock } from "@/features/live/ui/use-live-start-clock";
import timeStyles from "@/features/live/ui/live-time-indicator.module.css";

const AUTOPLAY_INTERVAL_MS = 6_000;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const carouselCopy = {
  ko: {
    label: "주요 LIVE",
    pause: "자동 재생 정지",
    resume: "자동 재생 시작",
    previous: "이전 LIVE",
    next: "다음 LIVE",
    goTo: (index: number) => `${index}번째 LIVE 보기`,
    position: (index: number, total: number) => `${index} / ${total}`,
    reserve: "라이브 예약하기",
    enter: "라이브 입장하기",
    details: "LIVE 상세보기",
    noneStatus: "공개된 LIVE 없음",
    noneTitle: "새로운 LIVE를 준비하고 있어요.",
  },
  en: {
    label: "Featured LIVE events",
    pause: "Pause autoplay",
    resume: "Start autoplay",
    previous: "Previous LIVE",
    next: "Next LIVE",
    goTo: (index: number) => `View LIVE ${index}`,
    position: (index: number, total: number) => `${index} of ${total}`,
    reserve: "Reserve LIVE",
    enter: "Enter LIVE",
    details: "View LIVE details",
    noneStatus: "No published LIVE",
    noneTitle: "A new LIVE is in preparation.",
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

export function formatLiveCountdown(startsAt: string, now: number, locale: ContentLocale = "ko") {
  return formatDetailedLiveCountdown(startsAt, now, locale);
}

export function formatHeroLiveTitle(celebrityName: string) {
  return `${celebrityName} LIVE`;
}

export function LiveCountdown({
  id,
  effectiveStatus,
  startsAt,
  active,
  locale = "ko",
  onStartReached,
}: {
  id?: string;
  effectiveStatus: LiveEventResponse["live"]["effectiveStatus"];
  startsAt: string;
  active: boolean;
  locale?: ContentLocale;
  onStartReached?: (event: LiveStartEvent) => void;
}) {
  const { now, visible } = useLiveStartClock({ id, effectiveStatus, startsAt }, { active, precision: "second", onStartReached });
  const shouldPulse = active && visible && effectiveStatus === "scheduled" && now !== null && Date.parse(startsAt) > now;

  const value = effectiveStatus === "live"
    ? "LIVE NOW"
    : now === null
      ? "--:--:--"
      : formatLiveCountdown(startsAt, now, locale);

  return <span className={timeStyles.emphasis} data-tone="on-image" data-status={effectiveStatus} data-pulse={shouldPulse ? "true" : "false"} aria-live="off">
    {effectiveStatus === "scheduled" ? <span className={timeStyles.dot} aria-hidden="true" /> : null}
    {value}
  </span>;
}

export function LiveHeroCarousel({
  featuredLives,
  locale,
  onStartReached,
  elina,
}: {
  elina?: PublishedCelebrity;
  featuredLives: readonly LiveEventResponse[];
  locale: ContentLocale;
  onStartReached?: (event: LiveStartEvent) => void;
}) {
  const t = carouselCopy[locale];
  const total = featuredLives.length + 1;
  const hasControls = total > 1;
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [pointerActive, setPointerActive] = useState(false);
  const [inView, setInView] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(true);
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
    if (!root) return;
    let visible = typeof IntersectionObserver === "undefined";
    const syncVisibility = () => {
      setInView(visible);
      setDocumentVisible(!document.hidden);
      root.dataset.motionVisible = String(visible && !document.hidden);
    };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      syncVisibility();
    });
    observer?.observe(root);
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    const releasePointer = () => setPointerActive(false);
    window.addEventListener("pointerup", releasePointer);
    window.addEventListener("pointercancel", releasePointer);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", syncVisibility);
      window.removeEventListener("pointerup", releasePointer);
      window.removeEventListener("pointercancel", releasePointer);
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

  const visible = inView && documentVisible;
  const autoplayPaused = userPaused || hovered || focusWithin || pointerActive || !visible || reducedMotion;

  useEffect(() => {
    if (total <= 1 || autoplayPaused) return;
    const timer = window.setTimeout(() => goTo(activeIndex + 1, false), AUTOPLAY_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [activeIndex, goTo, autoplayPaused, timerRevision, total]);

  return (
    <div
      className={styles.heroCarousel}
      ref={rootRef}
      role="region"
      aria-roledescription="carousel"
      aria-label={t.label}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      data-has-controls={hasControls ? "true" : "false"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
          setFocusWithin(false);
        }
      }}
      onPointerDown={() => setPointerActive(true)}
      onPointerUp={() => setPointerActive(false)}
      onPointerCancel={() => setPointerActive(false)}
    >
      <div className={styles.heroViewport} ref={viewportRef}>
        <div className={styles.heroTrack}>
          {featuredLives.map((featuredLive, index) => {
          const isActive = index === activeIndex;
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
            >
              <HomeHeroBanner kind="live"
                desktopImage={<EventPhoto photos={featuredLive.live.photos} src={featuredLive.live.heroImage.url} alt={featuredLive.live.heroImage.alt} locale={locale} priority={index === 0} sizes={homeHeroSizes()} />}
                image={<CreatorImage slug={featuredLive.live.celebrity.slug} src={featuredLive.live.celebrity.image} photos={featuredLive.live.celebrity.photos} position={featuredLive.live.celebrity.imagePosition} presentation="editorial" locale={locale} alt="" fill priority={index === 0} sizes="(max-width: 767px) calc(100vw - 32px), 1px" />}
                eyebrow={<span><Radio />{statusLabel}</span>}
                title={formatHeroLiveTitle(featuredLive.live.celebrity.name)}
                description={<>
                  <span>{formatLiveDate(featuredLive.live.startsAt, locale)}</span>
                  <LiveCountdown id={featuredLive.live.id} effectiveStatus={featuredLive.live.effectiveStatus} startsAt={featuredLive.live.startsAt} active={isActive && visible} locale={locale} onStartReached={onStartReached} />
                </>}
                action={featuredLive.primaryAction === "sign_in_to_reserve" ? (
                  <AuthIntentLink
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
                  <Link data-fan-action-emphasis="primary" href={`${detailHref}?locale=${locale}` as Route}>
                    <span><Play />{heroActionLabel}</span><ArrowRight />
                  </Link>
                )}
              />
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
            <ElinaGuideCard locale={locale} elina={elina} hero priority={featuredLives.length === 0} />
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
            style={{ "--carousel-width": `${total * 44 + 44}px` } as CSSProperties}
          >
            {[...featuredLives.map((featuredLive) => featuredLive.live.slug), "elina-guide"].map((key, index) => (
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
            <button className={styles.carouselPause} type="button" aria-label={userPaused ? t.resume : t.pause}
              aria-pressed={userPaused} disabled={reducedMotion} onClick={() => setUserPaused((value) => !value)}>
              {userPaused || reducedMotion ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            </button>
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
