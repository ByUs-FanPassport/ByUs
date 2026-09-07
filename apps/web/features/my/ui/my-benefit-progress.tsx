"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowRight, Check, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { FanAction } from "@/components/fan-ui/fan-action";
import { useOwnedFanResource } from "@/components/fan-ui/use-owned-fan-resource";
import type { FanLocale } from "@/components/fan-shell/fan-app-shell";
import { levelLabel, stampTypeLabel } from "../../passport/domain/passport-read-model";
import type { NextPassportBenefit } from "../../passport/domain/passport-detail";
import { benefitScorePercent, myBenefitPassportSchema, type PassportCreator } from "../domain/my-progress";
import styles from "./my-benefit-progress.module.css";

const copy = {
  ko: {
    choose: "혜택을 확인할 최애", loading: "다음 혜택을 불러오는 중이에요.",
    error: "다음 혜택을 불러오지 못했어요.", retry: "다시 시도", empty: "현재 이 최애의 다음 혜택이 없어요.",
    all: "혜택 전체 보기", view: "혜택 확인하기", score: "팬 점수", scoreProgress: "팬 점수 조건 달성률",
    remaining: "남은 조건", ready: "조건 충족", locked: "조건을 달성하면 받을 수 있어요.",
    applyReady: "조건 충족 · 신청 가능", applyLocked: "조건 달성 후 신청 가능",
    submitted: "신청 완료 · 선정 대기", selected: "선정 완료", notSelected: "미선정",
    selectionHelp: "신청 후 선정 결과에 따라 혜택이 제공돼요.",
    stale: "최신 조건을 확인하지 못했어요.",
  },
  en: {
    choose: "Favorite to view benefits for", loading: "Loading your next benefit.",
    error: "We couldn’t load the next benefit.", retry: "Try again", empty: "No next benefit for this favorite right now.",
    all: "View all benefits", view: "View benefit", score: "Fan Score", scoreProgress: "Fan Score requirement progress",
    remaining: "Remaining conditions", ready: "Conditions met", locked: "Complete the conditions to unlock it.",
    applyReady: "Conditions met · Applications open", applyLocked: "Meet the conditions to apply",
    submitted: "Applied · Awaiting selection", selected: "Selected", notSelected: "Not selected",
    selectionHelp: "Benefits are provided based on the selection result after you apply.",
    stale: "We couldn’t refresh the conditions.",
  },
} as const;

function benefitStatus(benefit: NextPassportBenefit, locale: FanLocale) {
  const t = copy[locale];
  if (benefit.allocationMode === "application_selection") {
    if (benefit.applicationStatus === "submitted") return t.submitted;
    if (benefit.applicationStatus === "selected") return t.selected;
    if (benefit.applicationStatus === "not_selected") return t.notSelected;
    return benefit.state === "eligible" ? t.applyReady : t.applyLocked;
  }
  return benefit.state === "eligible" ? t.ready : t.locked;
}

function conditionLabel(condition: NextPassportBenefit["missingConditions"][number], locale: FanLocale) {
  switch (condition.type) {
    case "score": return `${copy[locale].score} ${condition.current} / ${condition.required}`;
    case "level": return locale === "ko" ? `${levelLabel(locale, condition.required)} 등급 필요` : `${levelLabel(locale, condition.required)} level required`;
    case "stamp": return `${stampTypeLabel(locale, condition.required)} ${locale === "ko" ? "스탬프 필요" : "Stamp required"}`;
    case "activity": return locale === "ko" ? `${stampTypeLabel(locale, condition.required)} 완료 필요` : `${stampTypeLabel(locale, condition.required)} activity required`;
    case "opens_at": return `${locale === "ko" ? "신청·수령 시작" : "Opens"}: ${new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(condition.at))} KST`;
  }
}

export function MyBenefitProgress({ creators, locale }: { creators: readonly PassportCreator[]; locale: FanLocale }) {
  const [chosenId, setChosenId] = useState<string | null>(null);
  const selected = creators.find(creator => creator.passport.id === chosenId) ?? creators[0];
  const t = copy[locale];
  if (!selected) return null;
  return <div className={styles.panel}>
    {creators.length > 1 ? <label className={styles.selector}>
      <span>{t.choose}</span>
      <select value={selected.passport.id} onChange={event => setChosenId(event.target.value)}>
        {creators.map(creator => <option key={creator.passport.id} value={creator.passport.id}>{creator.celebrity.name}</option>)}
      </select>
    </label> : <p className={styles.creatorName}>{selected.celebrity.name}</p>}
    <SelectedBenefit creator={selected} locale={locale}/>
  </div>;
}

function SelectedBenefit({ creator, locale }: { creator: PassportCreator; locale: FanLocale }) {
  const auth = usePrivy();
  const parse = useCallback((body: unknown) => {
    const { passport } = myBenefitPassportSchema.parse(body);
    if (passport.id !== creator.passport.id || passport.celebrity.slug !== creator.celebrity.slug) throw new Error("Passport does not match selected creator");
    return passport;
  }, [creator.passport.id, creator.celebrity.slug]);
  const resource = useOwnedFanResource(`/api/passports/${encodeURIComponent(creator.passport.id)}?locale=${locale}`, parse, auth);
  const t = copy[locale];
  const allHref = `/benefits?locale=${locale}&celebrity=${encodeURIComponent(creator.celebrity.slug)}` as const;
  if (resource.state.status === "loading") return <div className={styles.loading} role="status"><span className={styles.skeleton}/><p>{t.loading}</p></div>;
  if (resource.state.status === "error") return <div className={styles.message} role="status"><p>{t.error}</p><FanAction variant="neutral" onClick={resource.retry} leadingIcon={<RotateCcw/>}>{t.retry}</FanAction></div>;
  const passport = resource.state.data;
  const benefit = passport.nextBenefit;
  if (!benefit) return <div className={styles.message}><p>{t.empty}</p><Link className={styles.link} href={allHref}>{t.all}<ArrowRight aria-hidden="true"/></Link></div>;
  const percent = benefitScorePercent(passport.score.points, benefit.minimumScore);
  const otherConditions = benefit.missingConditions.filter(condition => condition.type !== "score");
  return <div className={styles.benefit}>
    <h3>{benefit.title}</h3>
    <p className={styles.eligibility}>{benefit.eligibilityLabel}</p>
    {percent !== null ? <div className={styles.score}>
      <div><span>{t.score}</span><strong>{passport.score.points} <span>/ {benefit.minimumScore}</span></strong></div>
      <progress value={percent} max={100} aria-label={t.scoreProgress}>{percent}%</progress>
      {passport.score.points < benefit.minimumScore ? <p>{locale === "ko" ? `${benefit.minimumScore - passport.score.points}점 더 필요해요.` : `${benefit.minimumScore - passport.score.points} more points needed.`}</p> : null}
    </div> : null}
    {otherConditions.length ? <div className={styles.conditions}><h4>{t.remaining}</h4><ul>{otherConditions.map((condition, index) => <li key={`${condition.type}-${index}`}>{conditionLabel(condition, locale)}</li>)}</ul></div> : null}
    <p className={styles.status} data-eligible={benefit.state === "eligible" && benefit.allocationMode === "direct_claim"}>
      {benefit.state === "eligible" && benefit.allocationMode === "direct_claim" ? <Check aria-hidden="true"/> : null}{benefitStatus(benefit, locale)}
    </p>
    {benefit.allocationMode === "application_selection" ? <p className={styles.selectionHelp}>{t.selectionHelp}</p> : null}
    {resource.refreshFailed ? <p className={styles.refresh} role="status">{t.stale} <button type="button" onClick={resource.retry}>{t.retry}</button></p> : null}
    <Link className={styles.link} href={`/benefits/${benefit.id}?locale=${locale}`}>{t.view}<ArrowRight aria-hidden="true"/></Link>
  </div>;
}
