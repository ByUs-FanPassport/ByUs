"use client";

import { messages as localizedMessages } from "@/i18n/catalogs/features__fanpage__ui__fan-score-progress";
import { translate } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/locales";
import { useEffect, useId, useRef, useState } from "react";
import { fanTierProgress, type PassportCreator } from "@/features/my/domain/my-progress";
import { levelLabel } from "@/features/passport/domain/passport-read-model";
import { fanStageLabel } from "@/features/rewards/domain/fan-stage";
import styles from "./fan-score-progress.module.css";

type Props = {
  passport: PassportCreator["passport"];
  locale: AppLocale;
};

export function FanScoreProgress({ passport, locale }: Props) {
  const { nextTier, nextThreshold, maxed } = fanTierProgress(passport);
  const stage = passport.stageProgress;
  const ko = locale === "ko";
  const tooltipId = useId();
  const root = useRef<HTMLDivElement>(null);
  const pinned = useRef(false);
  const [open, setOpen] = useState(false);
  const score = passport.score.toLocaleString(locale);
  const target = nextThreshold?.toLocaleString(locale);
  let title = locale === "ko" ? "최고 등급 달성" : translate(locale, localizedMessages.md9c4419e2bdd, "Top tier reached");
  if (nextTier) {
    title = locale === "ko" ? `현재 점수 / ${levelLabel(locale, nextTier)} 기준` : translate(locale, localizedMessages.m39c723c64f5d, "Current score / {0} target", [nextTier]);
  }
  const value = maxed
    ? `${score}${locale === "ko" ? "점" : translate(locale, localizedMessages.m2d8c681d11b6, " points")}`
    : `${score} / ${target}${locale === "ko" ? "점" : translate(locale, localizedMessages.m2d8c681d11b6, " points")}`;
  const stageTitle = stage?.next
    ? (locale === "ko" ? `${fanStageLabel(locale, stage.next)}까지` : translate(locale, localizedMessages.m4e80451e0720, "To {0}", [fanStageLabel(locale, stage.next)]))
    : stage ? (locale === "ko" ? "최고 단계 달성" : translate(locale, localizedMessages.m016c9a365d4a, "Top stage reached")) : null;
  const stageValue = stage?.next
    ? `${stage.remaining.toLocaleString(locale)}${locale === "ko" ? "점 남음" : translate(locale, localizedMessages.m149e2e290f7c, " points remaining")}`
    : stage ? (locale === "ko" ? "모든 단계를 달성했어요" : translate(locale, localizedMessages.mc2f0efce3633, "All stages reached")) : null;
  const majorGoal = stage && nextTier && stage.next?.tier === stage.current.tier
    ? (locale === "ko" ? `${levelLabel(locale, nextTier)}까지 ${passport.remainingToNextTier.toLocaleString("ko-KR")}점` : translate(locale, localizedMessages.mce880b9e25c4, "{0} points to {1}", [passport.remainingToNextTier.toLocaleString("en-US"), nextTier]))
    : null;
  const currentScoreLabel = `${locale === "ko" ? "현재 점수" : translate(locale, localizedMessages.mf871410e5769, "Current score")}: ${score}${locale === "ko" ? "점" : translate(locale, localizedMessages.m2d8c681d11b6, " points")}`;

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
      aria-label={locale === "ko" ? "팬 점수 자세히 보기" : translate(locale, localizedMessages.m17d872928dd3, "View Fan Score details")}
      aria-expanded={open}
      aria-controls={tooltipId}
      aria-describedby={open ? tooltipId : undefined}
      onFocus={() => setOpen(true)}
      onBlur={() => { pinned.current = false; setOpen(false); }}
      onClick={() => { pinned.current = !pinned.current; setOpen(pinned.current); }}
    >
      <progress
        value={stage ? stage.progressPercent : maxed ? 1 : passport.score}
        max={stage ? 100 : maxed ? 1 : Math.max(1, nextThreshold ?? 0)}
        aria-label={locale === "ko" ? "팬 등급 진행도" : translate(locale, localizedMessages.mda729f4ab53d, "Fan tier progress")}
        aria-valuetext={stageTitle && stageValue ? `${stageTitle}: ${stageValue}. ${currentScoreLabel}${majorGoal ? `. ${majorGoal}` : ""}` : `${title}: ${value}`}
      />
    </button>
    <span className={styles.tooltip} role="tooltip" id={tooltipId} hidden={!open}>
      {stageTitle && stageValue ? <span className={styles.stageDetail}><span>{stageTitle}</span><strong>{stageValue}</strong></span> : null}
      {stage ? <span className={styles.currentDetail}><span>{locale === "ko" ? "현재 점수" : translate(locale, localizedMessages.mf871410e5769, "Current score")}</span><strong>{score}{locale === "ko" ? "점" : translate(locale, localizedMessages.m2d8c681d11b6, " points")}</strong></span> : <><span>{title}</span><strong>{value}</strong></>}
      {majorGoal ? <span className={styles.majorDetail}><span>{locale === "ko" ? "등급 목표" : translate(locale, localizedMessages.m2567390c480b, "Tier goal")}</span><strong>{majorGoal}</strong></span> : null}
    </span>
  </div>;
}
