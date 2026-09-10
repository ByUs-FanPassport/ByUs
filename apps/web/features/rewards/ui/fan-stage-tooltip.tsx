"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fanTierProgress } from "@/features/my/domain/my-progress";
import { levelLabel } from "@/features/passport/domain/passport-read-model";
import { fanStageLabel, type FanStageProgress } from "../domain/fan-stage";
import type { FanTier } from "../domain/reward-policy";
import { FanTierBadge } from "./fan-tier-badge";
import styles from "./fan-stage-tooltip.module.css";

export type FanStageTooltipProps = {
  celebrityName: string;
  tier: FanTier;
  points: number;
  stageProgress?: FanStageProgress | null;
  remainingToNextTier?: number;
  locale: "ko" | "en";
  variant?: "floating" | "inline";
  className?: string;
};

type Position = { left: number; top: number; side: "above" | "below" };

const VIEWPORT_GUTTER = 12;
const TOOLTIP_GAP = 10;

function joinClassNames(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(" ");
}

export function FanStageTooltip({
  celebrityName,
  tier,
  points,
  stageProgress = null,
  remainingToNextTier,
  locale,
  variant = "floating",
  className,
}: FanStageTooltipProps) {
  const ko = locale === "ko";
  const tooltipId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const currentStage = stageProgress ? fanStageLabel(locale, stageProgress.current) : levelLabel(locale, tier);
  const nextStage = stageProgress?.next ? fanStageLabel(locale, stageProgress.next) : null;
  const numberLocale = ko ? "ko-KR" : "en-US";
  const pointText = `${points.toLocaleString(numberLocale)}${ko ? "점" : " points"}`;

  const majorProgress = remainingToNextTier === undefined ? null : fanTierProgress({
    id: "fan-stage-tooltip",
    tier,
    score: points,
    remainingToNextTier,
    stageProgress,
  });
  const hasLaterMajorGoal = stageProgress !== null
    && stageProgress.next !== null
    && stageProgress.next.tier === stageProgress.current.tier;
  const majorGoal = hasLaterMajorGoal && majorProgress?.nextTier
    ? (ko
      ? `${levelLabel(locale, majorProgress.nextTier)}까지 ${majorProgress.remaining.toLocaleString(numberLocale)}점`
      : `${majorProgress.remaining.toLocaleString(numberLocale)} points to ${majorProgress.nextTier}`)
    : null;
  const summary = stageProgress
    ? `${celebrityName} · ${currentStage}. ${ko ? "현재" : "Current"} ${pointText}. ${stageProgress.next && nextStage
      ? (ko ? `${nextStage}까지 ${stageProgress.remaining.toLocaleString(numberLocale)}점` : `${stageProgress.remaining.toLocaleString(numberLocale)} points to ${nextStage}`)
      : (ko ? "최고 단계 도달" : "Top stage reached")}${majorGoal ? `. ${majorGoal}` : ""}`
    : `${celebrityName} · ${currentStage}. ${ko ? "현재" : "Current"} ${pointText}`;

  const cancelScheduledClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);
  const close = useCallback(() => {
    cancelScheduledClose();
    pinnedRef.current = false;
    setOpen(false);
  }, [cancelScheduledClose]);
  const scheduleClose = () => {
    cancelScheduledClose();
    closeTimerRef.current = setTimeout(() => {
      if (!pinnedRef.current) setOpen(false);
    }, 80);
  };

  useEffect(() => {
    setMounted(true);
    return cancelScheduledClose;
  }, [cancelScheduledClose]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!rootRef.current?.contains(event.target) && !tooltipRef.current?.contains(event.target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  useLayoutEffect(() => {
    if (!open || !mounted) {
      setPosition(null);
      return;
    }
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const tooltip = tooltipRef.current?.getBoundingClientRect();
      if (!trigger || !tooltip) return;
      const fitsAbove = trigger.top - TOOLTIP_GAP - tooltip.height >= VIEWPORT_GUTTER;
      const side = fitsAbove ? "above" : "below";
      const idealTop = side === "above" ? trigger.top - tooltip.height - TOOLTIP_GAP : trigger.bottom + TOOLTIP_GAP;
      const maxLeft = Math.max(VIEWPORT_GUTTER, window.innerWidth - tooltip.width - VIEWPORT_GUTTER);
      const maxTop = Math.max(VIEWPORT_GUTTER, window.innerHeight - tooltip.height - VIEWPORT_GUTTER);
      setPosition({
        left: Math.min(maxLeft, Math.max(VIEWPORT_GUTTER, trigger.left + trigger.width / 2 - tooltip.width / 2)),
        top: Math.min(maxTop, Math.max(VIEWPORT_GUTTER, idealTop)),
        side,
      });
    };
    const onResize = () => {
      // Home has separate responsive placements; dismiss the now-hidden trigger.
      if (!triggerRef.current?.getClientRects().length) {
        close();
        return;
      }
      place();
    };
    place();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", place, true);
    };
  }, [mounted, open, summary, close]);

  const trigger = <button
    ref={triggerRef}
    type="button"
    className={joinClassNames(styles.trigger, variant === "floating" ? styles.floatingTrigger : styles.inlineTrigger)}
    aria-label={summary}
    aria-expanded={open}
    aria-controls={tooltipId}
    aria-describedby={open ? tooltipId : undefined}
    onPointerEnter={(event) => {
      if (event.pointerType === "mouse") {
        cancelScheduledClose();
        setOpen(true);
      }
    }}
    onPointerLeave={(event) => { if (event.pointerType === "mouse") scheduleClose(); }}
    onFocus={() => setOpen(true)}
    onBlur={(event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && (rootRef.current?.contains(next) || tooltipRef.current?.contains(next))) return;
      if (!pinnedRef.current) setOpen(false);
    }}
    onClick={() => {
      pinnedRef.current = !pinnedRef.current;
      setOpen(pinnedRef.current);
    }}
  >
    {variant === "floating" && stageProgress ? <svg className={styles.progressRing} viewBox="0 0 36 36" aria-hidden="true">
      <circle className={styles.progressTrack} cx="18" cy="18" r="16" pathLength="100" />
      <circle className={styles.progressValue} cx="18" cy="18" r="16" pathLength="100" strokeDasharray={`${stageProgress.progressPercent} 100`} />
    </svg> : null}
    <FanTierBadge
      className={styles.badge}
      tier={tier}
      stageKey={stageProgress?.current.key}
      locale={locale}
      size={variant === "floating" ? 28 : 40}
    />
    {variant === "inline" ? <span className={styles.inlineCopy}><strong>{currentStage}</strong><small>LEVEL</small></span> : null}
  </button>;

  const tooltip = open && mounted ? createPortal(<div
    ref={tooltipRef}
    id={tooltipId}
    role="tooltip"
    className={styles.tooltip}
    data-side={position?.side}
    style={position ? { left: position.left, top: position.top } : undefined}
    onPointerEnter={(event) => { if (event.pointerType === "mouse") cancelScheduledClose(); }}
    onPointerLeave={(event) => { if (event.pointerType === "mouse") scheduleClose(); }}
  >
    <div className={styles.identity}><strong>{celebrityName}</strong><span aria-hidden="true">·</span><strong>{currentStage}</strong></div>
    <div className={styles.detail}><span>{ko ? "현재 점수" : "Current points"}</span><strong>{pointText}</strong></div>
    {stageProgress ? stageProgress.next && nextStage ? <div className={styles.detail}><span>{ko ? "다음 단계" : "Next stage"}</span><strong>{ko ? `${nextStage}까지 ${stageProgress.remaining.toLocaleString(numberLocale)}점` : `${stageProgress.remaining.toLocaleString(numberLocale)} points to ${nextStage}`}</strong></div> : <div className={styles.reached}>{ko ? "최고 단계에 도달했어요" : "Top stage reached"}</div> : null}
    {majorGoal ? <div className={joinClassNames(styles.detail, styles.majorGoal)}><span>{ko ? "등급 목표" : "Tier goal"}</span><strong>{majorGoal}</strong></div> : null}
  </div>, document.body) : null;

  return <span ref={rootRef} className={joinClassNames(styles.root, variant === "inline" && styles.inlineRoot, className)}>{trigger}{tooltip}</span>;
}
