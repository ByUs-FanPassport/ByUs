"use client";

import { useEffect, useId, useRef, useState } from "react";
import { fanTierProgress, type PassportCreator } from "@/features/my/domain/my-progress";
import { levelLabel } from "@/features/passport/domain/passport-read-model";
import styles from "./fan-score-progress.module.css";

type Props = {
  passport: PassportCreator["passport"];
  locale: "ko" | "en";
};

export function FanScoreProgress({ passport, locale }: Props) {
  const { nextTier, nextThreshold, maxed } = fanTierProgress(passport);
  const ko = locale === "ko";
  const tooltipId = useId();
  const root = useRef<HTMLDivElement>(null);
  const pinned = useRef(false);
  const [open, setOpen] = useState(false);
  const score = passport.score.toLocaleString(ko ? "ko-KR" : "en-US");
  const target = nextThreshold?.toLocaleString(ko ? "ko-KR" : "en-US");
  let title = ko ? "최고 등급 달성" : "Top tier reached";
  if (nextTier) {
    title = ko ? `현재 점수 / ${levelLabel(locale, nextTier)} 기준` : `Current score / ${nextTier} target`;
  }
  const value = maxed
    ? `${score}${ko ? "점" : " points"}`
    : `${score} / ${target}${ko ? "점" : " points"}`;

  useEffect(() => {
    if (!open) return;
    const dismiss = () => { pinned.current = false; setOpen(false); };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) dismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return <div
    ref={root}
    className={styles.root}
    onPointerEnter={(event) => { if (event.pointerType === "mouse") setOpen(true); }}
    onPointerLeave={() => { if (!pinned.current) setOpen(false); }}
  >
    <button
      className={styles.trigger}
      type="button"
      aria-label={ko ? "팬 점수 자세히 보기" : "View Fan Score details"}
      aria-expanded={open}
      aria-controls={tooltipId}
      aria-describedby={open ? tooltipId : undefined}
      onFocus={() => setOpen(true)}
      onBlur={() => { pinned.current = false; setOpen(false); }}
      onClick={() => { pinned.current = !pinned.current; setOpen(pinned.current); }}
    >
      <progress
        value={maxed ? 1 : passport.score}
        max={maxed ? 1 : Math.max(1, nextThreshold ?? 0)}
        aria-label={ko ? "팬 등급 진행도" : "Fan tier progress"}
        aria-valuetext={`${title}: ${value}`}
      />
    </button>
    <span className={styles.tooltip} role="tooltip" id={tooltipId} hidden={!open}>
      <span>{title}</span>
      <strong>{value}</strong>
    </span>
  </div>;
}
