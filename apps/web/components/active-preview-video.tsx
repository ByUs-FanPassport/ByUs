"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Pause, Play } from "lucide-react";

import styles from "./active-preview-video.module.css";

type PreviewMedia = Readonly<{
  videoUrl: string;
  posterUrl: string;
  durationMs: number;
}>;

type CoordinatorValue = {
  activeId: string | null;
  request(id: string): void;
  report(id: string, ratio: number): void;
};

const ActivePreviewContext = createContext<CoordinatorValue | null>(null);

function isCoarsePointer() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

export function ActivePreviewCoordinator({
  initialActiveId,
  children,
}: {
  initialActiveId: string | null;
  children: ReactNode;
}) {
  const [activeId, setActiveId] = useState<string | null>(initialActiveId);
  const ratios = useRef(new Map<string, number>());

  useEffect(() => {
    setActiveId(initialActiveId);
  }, [initialActiveId]);

  const report = useCallback((id: string, ratio: number) => {
    ratios.current.set(id, ratio);
    if (!isCoarsePointer()) return;
    const visible = [...ratios.current.entries()]
      .filter(([, value]) => value >= 0.6)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    setActiveId(visible[0]?.[0] ?? null);
  }, []);

  const value = useMemo<CoordinatorValue>(
    () => ({ activeId, request: setActiveId, report }),
    [activeId, report],
  );

  return (
    <ActivePreviewContext.Provider value={value}>
      {children}
    </ActivePreviewContext.Provider>
  );
}

function useMotionPolicy() {
  const [allowed, setAllowed] = useState(true);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }
    ).connection;
    const update = () => {
      setAllowed(
        !media.matches &&
          connection?.saveData !== true &&
          !["slow-2g", "2g"].includes(connection?.effectiveType ?? ""),
      );
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return allowed;
}

function previewControlLabel(
  locale: "ko" | "en",
  playing: boolean,
): string {
  if (locale === "ko") return playing ? "Preview 일시정지" : "Preview 재생";
  return playing ? "Pause Preview" : "Play Preview";
}

export function ActivePreviewVideo({
  id,
  preview,
  mode,
  locale = "en",
  className,
}: {
  id: string;
  preview: PreviewMedia;
  mode: "card" | "detail";
  locale?: "ko" | "en";
  className?: string;
}) {
  const coordinator = useContext(ActivePreviewContext);
  const activeId = coordinator?.activeId;
  const reportVisibility = coordinator?.report;
  const requestActivation = coordinator?.request;
  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const motionAllowed = useMotionPolicy();
  const [detailActive, setDetailActive] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [sourceReady, setSourceReady] = useState(false);
  const [playRejected, setPlayRejected] = useState(false);
  const active =
    motionAllowed &&
    documentVisible &&
    (mode === "detail" ? detailActive : activeId === id);

  useEffect(() => {
    if (mode !== "detail") return;
    const frame = requestAnimationFrame(() => setSourceReady(true));
    return () => cancelAnimationFrame(frame);
  }, [mode]);

  useEffect(() => {
    const visibility = () => setDocumentVisible(document.visibilityState !== "hidden");
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);

  useEffect(() => {
    if (mode !== "card" || !reportVisibility || !rootRef.current) {
      return;
    }
    if (!("IntersectionObserver" in window)) {
      setSourceReady(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        const ratio = entry?.intersectionRatio ?? 0;
        if (ratio > 0) setSourceReady(true);
        reportVisibility(id, ratio);
      },
      { threshold: [0, 0.6, 0.75, 1] },
    );
    observer.observe(rootRef.current);
    return () => {
      reportVisibility(id, 0);
      observer.disconnect();
    };
  }, [id, mode, reportVisibility]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!active || !sourceReady) {
      video.pause();
      if (mode === "card") video.currentTime = 0;
      return;
    }
    setPlayRejected(false);
    void video.play().catch(() => {
      setPlayRejected(true);
      if (mode === "detail") setDetailActive(false);
    });
  }, [active, mode, sourceReady]);

  const buttonLabel = previewControlLabel(
    locale,
    detailActive && !playRejected,
  );

  return (
    <span
      ref={rootRef}
      className={`${styles.root} ${className ?? ""}`}
      data-preview-mode={mode}
      onPointerEnter={() => mode === "card" && requestActivation?.(id)}
      onFocusCapture={() => mode === "card" && requestActivation?.(id)}
    >
      <video
        ref={videoRef}
        data-testid="active-preview-video"
        aria-hidden="true"
        muted
        playsInline
        loop={mode === "detail"}
        preload="none"
        poster={preview.posterUrl}
        src={active && sourceReady ? preview.videoUrl : undefined}
        onError={() => {
          setPlayRejected(true);
          if (mode === "detail") setDetailActive(false);
        }}
      />
      {mode === "detail" && motionAllowed ? (
        <button
          className={styles.control}
          type="button"
          aria-label={buttonLabel}
          onClick={() => {
            setPlayRejected(false);
            setDetailActive((value) => !value);
          }}
        >
          {detailActive && !playRejected ? (
            <Pause aria-hidden="true" />
          ) : (
            <Play aria-hidden="true" />
          )}
        </button>
      ) : null}
    </span>
  );
}
