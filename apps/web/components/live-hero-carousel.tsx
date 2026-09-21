"use client";

import type { AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/components__live-hero-carousel";
import { additionalLocales, translate } from "@/i18n/messages";
import useEmblaCarousel from "embla-carousel-react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveEventResponse } from "../features/live/domain/live-event";
import type { ContentLocale, PublishedCelebrity } from "../server/content/content-domain";
import { Pause } from "lucide-react";
import { ChevronLeft, ChevronRight, Play } from "./icons";
import styles from "./guest-home.module.css";
import { ElinaGuideCard } from "./home-entry-cards/home-entry-cards";
import { formatDetailedLiveCountdown, type LiveStartEvent } from "@/features/live/domain/live-time-display";
import { useLiveStartClock } from "@/features/live/ui/use-live-start-clock";
import timeStyles from "@/features/live/ui/live-time-indicator.module.css";

import type { HomeBanner } from "../features/home/domain/home-banner";
import { ManagedHomeBanner } from "./home-entry-cards/managed-home-banner";

const AUTOPLAY_INTERVAL_MS = 6_000;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const carouselCopy = {
  ko: {
    label: "홈 배너",
    pause: "자동 재생 정지",
    resume: "자동 재생 시작",
    previous: "이전 배너",
    next: "다음 배너",
    goTo: (index: number) => `${index}번째 배너 보기`,
    position: (index: number, total: number) => `${index} / ${total}`,
  },
  en: {
    label: "Home banners",
    pause: "Pause autoplay",
    resume: "Start autoplay",
    previous: "Previous banner",
    next: "Next banner",
    goTo: (index: number) => `View banner ${index}`,
    position: (index: number, total: number) => `${index} of ${total}`,
  },

  ...additionalLocales((translationLocale) => ({
    label: localizedMessages.md9901b1ddbd2[translationLocale],
    pause: localizedMessages.m0389db05acd4[translationLocale],
    resume: localizedMessages.m45b7c4707cdd[translationLocale],
    previous: localizedMessages.mdab6c9431b74[translationLocale],
    next: localizedMessages.m679b450a65d7[translationLocale],
    goTo: (index: number) => translate(translationLocale, localizedMessages.me7dbdaa8ca43, "View banner {0}", [index]),
    position: (index: number, total: number) => translate(translationLocale, localizedMessages.me955757b0bb0, "{0} of {1}", [index, total]),
  }))
} as const;

export function formatLiveCountdown(startsAt: string, now: number, locale: AppLocale = "ko") {
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
  locale?: AppLocale;
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
  homeBanners,
  locale,
  elina,
}: {
  elina?: PublishedCelebrity;
  homeBanners: readonly HomeBanner[];
  locale: AppLocale;
}) {
  const t = carouselCopy[locale];
  const total = homeBanners.length + 1;
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
          {homeBanners.map((banner, index) => (
            <article className={styles.heroCard} key={banner.id}
              aria-hidden={index !== activeIndex} aria-roledescription="slide"
              aria-label={t.position(index + 1, total)} inert={index !== activeIndex}
              data-active={index === activeIndex ? "true" : "false"}>
              <ManagedHomeBanner banner={banner} locale={locale} priority={index === 0} />
            </article>
          ))}
          <article
            className={`${styles.heroCard} ${styles.campaignHeroCard}`}
            aria-hidden={activeIndex !== homeBanners.length}
            aria-roledescription="slide"
            aria-label={t.position(total, total)}
            inert={activeIndex !== homeBanners.length}
            data-active={activeIndex === homeBanners.length ? "true" : "false"}
          >
            <ElinaGuideCard locale={locale} elina={elina} hero priority={homeBanners.length === 0} />
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
            {[...homeBanners.map((banner) => banner.id), "elina-guide"].map((key, index) => (
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
