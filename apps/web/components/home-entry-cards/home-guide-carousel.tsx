"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import type { ContentLocale } from "@/server/content/content-domain";
import styles from "./home-entry-cards.module.css";

const ROTATION_INTERVAL = 6_000;
const copy = {
  ko: { label: "참여 가이드", previous: "이전 가이드", next: "다음 가이드", pause: "자동 재생 정지", resume: "자동 재생 시작", reduced: "동작 줄이기 설정으로 자동 재생이 꺼져 있어요." },
  en: { label: "Participation guides", previous: "Previous guide", next: "Next guide", pause: "Pause autoplay", resume: "Start autoplay", reduced: "Autoplay is off because reduced motion is enabled." },
};

export function HomeGuideCarousel({ locale, slides }: {
  locale: ContentLocale;
  slides: { key: string; label: string; content: ReactNode }[];
}) {
  const t = copy[locale];
  const rootRef = useRef<HTMLDivElement>(null);
  const playbackPointerIntent = useRef<boolean | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [viewportRef, emblaApi] = useEmblaCarousel({ loop: true, duration: 24, watchDrag: !reducedMotion });

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let inView = typeof IntersectionObserver === "undefined";
    const sync = () => setVisible(inView && !document.hidden);
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      sync();
    }, { threshold: 0.1 });
    observer?.observe(root);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  useEffect(() => {
    if (!emblaApi) return;
    const sync = () => setActiveIndex(emblaApi.selectedScrollSnap());
    const pause = () => setUserPaused(true);
    sync();
    emblaApi.on("select", sync).on("reInit", sync).on("pointerDown", pause);
    return () => { emblaApi.off("select", sync).off("reInit", sync).off("pointerDown", pause); };
  }, [emblaApi]);

  const goTo = useCallback((index: number, manual: boolean) => {
    const next = (index + slides.length) % slides.length;
    if (emblaApi) emblaApi.scrollTo(next, reducedMotion);
    else setActiveIndex(next);
    if (manual) setUserPaused(true);
  }, [emblaApi, reducedMotion, slides.length]);
  const rotating = slides.length > 1 && visible && !userPaused && !hovered && !reducedMotion;

  useEffect(() => {
    if (!rotating) return;
    const timer = window.setTimeout(() => goTo(activeIndex + 1, false), ROTATION_INTERVAL);
    return () => window.clearTimeout(timer);
  }, [activeIndex, goTo, rotating]);

  return (
    <div
      ref={rootRef}
      className={styles.carousel}
      role="region"
      aria-roledescription="carousel"
      aria-label={t.label}
      data-home-guide-carousel
      data-rotation={rotating ? "playing" : "paused"}
      data-reduced-motion={reducedMotion}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setUserPaused(true);
      }}
    >
      <div className={styles.carouselControls}>
        <button
          type="button"
          className={styles.carouselButton}
          aria-label={userPaused || reducedMotion ? t.resume : t.pause}
          title={reducedMotion ? t.reduced : userPaused ? t.resume : t.pause}
          disabled={reducedMotion}
          onPointerDown={() => { playbackPointerIntent.current = !userPaused; }}
          onPointerCancel={() => { playbackPointerIntent.current = null; }}
          onKeyDown={() => { playbackPointerIntent.current = null; }}
          onClick={() => {
            setUserPaused(playbackPointerIntent.current ?? !userPaused);
            playbackPointerIntent.current = null;
          }}
        >
          {userPaused || reducedMotion ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
        </button>
        <button type="button" className={styles.carouselButton} aria-label={t.previous} onClick={() => goTo(activeIndex - 1, true)}><ChevronLeft size={16} aria-hidden="true" /></button>
        <button type="button" className={styles.carouselButton} aria-label={t.next} onClick={() => goTo(activeIndex + 1, true)}><ChevronRight size={16} aria-hidden="true" /></button>
      </div>
      <div className={styles.carouselViewport} ref={viewportRef}>
        <div className={styles.carouselTrack} aria-live={rotating ? "off" : "polite"} aria-atomic="false">
          {slides.map((slide, index) => (
            <div key={slide.key} className={styles.carouselSlide} role="group" aria-roledescription="slide" aria-label={`${index + 1} / ${slides.length} · ${slide.label}`} aria-hidden={index !== activeIndex} inert={index !== activeIndex} data-active={index === activeIndex}>
              {slide.content}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
