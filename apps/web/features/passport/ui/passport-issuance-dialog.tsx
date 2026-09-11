"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check, Copy as CopyIcon, RotateCcw } from "lucide-react";

import { AuthIntentLink } from "@/components/auth-intent-link";
import { FocusFlowFrame } from "@/components/fan-shell/focus-flow-frame";
import { FanAction, fanActionClassName } from "@/components/fan-ui/fan-action";
import { parseIssuanceAggregate, type IssuanceAggregate } from "../domain/issuance-aggregate";
import { levelLabel, type PassportLocale } from "../domain/passport-read-model";
import { sanitizeLiveReturnTo } from "@/features/quiz/domain/live-return-context";
import { PassportStampCanvas, VerificationSealArtwork } from "./passport-stamp-artwork";
import styles from "./passport-issuance-dialog.module.css";

interface PassportIssuanceCeremonyProps { issuance: IssuanceAggregate }

const copy = {
  ko: {
    skip: "건너뛰기",
    progress: "Passport 발급 과정",
    completeTitle: (name: string) => `${name} Passport 발급 완료`,
    completeBody: "첫 팬 인증 Stamp와 팬 점수 +1이 기록됐어요.",
    score: "이번 인증으로 받은 점수",
    level: "시작 등급",
    fanId: "Fan ID",
    copyFanId: "전체 Fan ID 복사",
    copiedFanId: "Fan ID를 복사했어요.",
    copyFanIdFailed: "Fan ID를 복사하지 못했어요.",
    stampEarned: "팬 인증 Stamp 획득",
    open: "Passport 열기",
    continueLive: "LIVE 예약 이어가기",
    myHint: "내 Passport는 MY에서 다시 볼 수 있어요.",
    openMy: "MY에서 보기",
    waiting: "첫 팬 인증 기록을 보여드릴게요.",
    mintComplete: "디지털 발급 완료",
    mintChecking: "발급 상태 확인 중",
    mintProcessing: "디지털 발급 확인 중",
    mintPreparing: "디지털 발급 준비 중",
    passportAvailable: "Passport는 지금 사용할 수 있어요.",
    loadingTitle: "발급된 Passport 확인 중",
    loadingBody: "이미 완료된 팬 인증 결과를 안전하게 불러오고 있어요.",
    authTitle: "로그인이 필요해요.",
    authBody: "내 계정에 이미 발급된 Passport를 확인하려면 로그인해 주세요.",
    authAction: "로그인하고 발급 결과 확인하기",
    errorTitle: "발급 결과를 불러오지 못했어요.",
    errorBody: "잠시 후 다시 확인하거나, 내 Passport를 열어보세요.",
    retry: "다시 확인",
  },
  en: {
    skip: "Skip",
    progress: "Passport issuance progress",
    completeTitle: (name: string) => `${name} Passport issued`,
    completeBody: "Your first fan verification Stamp and +1 fan score are recorded.",
    score: "Points earned from verification",
    level: "Starting level",
    fanId: "Fan ID",
    copyFanId: "Copy full Fan ID",
    copiedFanId: "Fan ID copied.",
    copyFanIdFailed: "Couldn’t copy the Fan ID.",
    stampEarned: "Fan Verification Stamp earned",
    open: "Open Passport",
    continueLive: "Continue LIVE reservation",
    myHint: "Find your Passport again in MY.",
    openMy: "View in MY",
    waiting: "Showing your first fan verification record.",
    mintComplete: "Digital issuance complete",
    mintChecking: "Checking issuance status",
    mintProcessing: "Confirming digital issuance",
    mintPreparing: "Preparing digital issuance",
    passportAvailable: "Your Passport is ready to use.",
    loadingTitle: "Checking your issued Passport",
    loadingBody: "Loading the fan verification result that has already been completed.",
    authTitle: "Sign in required",
    authBody: "Sign in to view the Passport already issued to your account.",
    authAction: "Sign in and view issuance",
    errorTitle: "We couldn’t load the issuance result.",
    errorBody: "Try again in a moment, or open your Passport.",
    retry: "Try again",
  },
} as const;

function localeFrom(value: string | null): PassportLocale {
  return value === "en" ? "en" : "ko";
}

function withLocale(path: string, locale: PassportLocale): Route {
  return `${path}?locale=${locale}` as Route;
}

function issuanceStatus(issuance: IssuanceAggregate, locale: PassportLocale): string {
  const t = copy[locale];
  const statuses = [issuance.passport.mintStatus, issuance.firstStamp.mintStatus];
  if (statuses.every((status) => status === "minted")) return t.mintComplete;
  if (statuses.some((status) => status === "retryable" || status === "permanent_failure")) {
    return t.mintChecking;
  }
  if (statuses.some((status) => status === "processing")) return t.mintProcessing;
  return t.mintPreparing;
}

function shortPassportId(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-4)}`.toUpperCase();
}

export function PassportIssuanceCeremony({
  issuance,
  locale = "ko",
  returnTo,
}: PassportIssuanceCeremonyProps & { locale?: PassportLocale; returnTo?: string | null }) {
  const [stage, setStage] = useState(0);
  const t = copy[locale];
  const progress = stage + 1;
  const level = levelLabel(locale, "Bronze");
  const stampDate = new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(issuance.firstStamp.issuedAt));
  const passportHref = withLocale(`/passports/${issuance.passport.id}`, locale);
  const liveReturnTo = sanitizeLiveReturnTo(returnTo);
  const finalHref = (liveReturnTo ?? passportHref) as Route;
  const finalLabel = liveReturnTo ? t.continueLive : t.open;
  const skipRef = useRef<HTMLButtonElement>(null);
  const openPassportRef = useRef<HTMLAnchorElement>(null);
  const focusOpenOnCompletionRef = useRef(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  const copyPassportId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(issuance.passport.id);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }, [issuance.passport.id]);

  const completePresentation = useCallback((focusOpenPassport = false) => {
    focusOpenOnCompletionRef.current = focusOpenPassport;
    setStage(3);
  }, []);

  useEffect(() => {
    function completeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      completePresentation(true);
    };
    document.addEventListener("keydown", completeOnEscape);
    return () => document.removeEventListener("keydown", completeOnEscape);
  }, [completePresentation]);

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduced) {
      completePresentation(false);
      return;
    }
    const timers = [
      window.setTimeout(() => setStage((current) => Math.max(current, 1)), 450),
      window.setTimeout(() => setStage((current) => Math.max(current, 2)), 900),
      window.setTimeout(() => {
        completePresentation(document.activeElement === skipRef.current);
      }, 1_350),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, [completePresentation]);

  useEffect(() => {
    if (stage !== 3 || !focusOpenOnCompletionRef.current) return;
    focusOpenOnCompletionRef.current = false;
    openPassportRef.current?.focus();
  }, [stage]);

  return (
    <FocusFlowFrame
      locale={locale}
      mainId="passport-issuance-main"
      headerActions={
        <div className={styles.headerActions}>
          <div className={styles.progress}>
            <span>{progress} / 4</span>
            <progress aria-label={t.progress} max={4} value={progress} />
          </div>
          {stage < 3 ? (
            <button
              ref={skipRef}
              className={styles.skip}
              type="button"
              onClick={() => completePresentation(true)}
            >
              {t.skip}
            </button>
          ) : null}
        </div>
      }
    >
    <main
      className={styles.screen}
      id="passport-issuance-main"
      tabIndex={-1}
      aria-labelledby="passport-issuance-title"
    >
      <div className={styles.frame}>
        <header className={styles.ceremonyIntro}>
          <h1 id="passport-issuance-title">{t.completeTitle(issuance.celebrity.name)}</h1>
          <p>{t.completeBody}</p>
        </header>
        <div className={styles.content}>
          <div className={styles.visualColumn}>
            <section className={styles.passport} aria-label={`${issuance.celebrity.name} Fan Passport`}>
              <PassportStampCanvas
                celebrityName={issuance.celebrity.name}
                level={level}
                stamps={[{
                  type: issuance.firstStamp.type,
                  issuedAt: issuance.firstStamp.issuedAt,
                  points: issuance.score.points,
                }]}
                totalCount={1}
                revealCount={stage >= 2 ? 1 : 0}
                locale={locale}
                priority
              />
              <div className={styles.passportFields}>
                <span
                  className={styles.starValue}
                  aria-label={`STAR: ${issuance.celebrity.name}`}
                  title={issuance.celebrity.name}
                  data-passport-field="star"
                >
                  {issuance.celebrity.name}
                </span>
                <span
                  className={styles.issueDateValue}
                  aria-label={`DATE OF ISSUE: ${stampDate}`}
                  data-passport-field="issue-date"
                >
                  {stampDate}
                </span>
                <span
                  className={styles.fanIdValue}
                  aria-label={`FAN ID: ${issuance.passport.id}`}
                  data-wrap-anywhere
                  data-passport-field="fan-id"
                >
                  {shortPassportId(issuance.passport.id)}
                </span>
              </div>
              {stage >= 1 && stage < 3 ? (
                <div
                  className={styles.stampMoment}
                  data-issuance-stamp-moment
                  data-state={stage === 1 ? "impact" : "settling"}
                >
                  <div className={styles.stampImpact}>
                    <VerificationSealArtwork
                      celebrityName={issuance.celebrity.name}
                      issuedAt={issuance.firstStamp.issuedAt}
                      points={issuance.score.points}
                      locale={locale}
                    />
                  </div>
                </div>
              ) : null}
            </section>
          </div>

          <div className={styles.sideColumn}>
            <aside className={styles.summary} aria-label={locale === "ko" ? "팬 인증 기록" : "Fan verification record"}>
              <div className={styles.scoreSummary}>
                <span>{t.score}</span>
                <strong aria-live="polite">+{stage >= 2 ? issuance.score.points : 0}</strong>
              </div>
              <p className={styles.stampStatus} aria-live="polite">{stage >= 1 && <Check aria-hidden="true" />}{stage >= 1 ? t.stampEarned : t.waiting}</p>
              <dl className={styles.summaryFacts}>
                <div><dt>{t.level}</dt><dd>{level}</dd></div>
                <div>
                  <dt>{t.fanId}</dt>
                  <dd>
                    <button type="button" onClick={() => void copyPassportId()} aria-label={t.copyFanId}>
                      <span data-wrap-anywhere>{shortPassportId(issuance.passport.id)}</span>
                      {copyStatus === "copied" ? <Check aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
                    </button>
                  </dd>
                </div>
              </dl>
              <div className={styles.mintStatus}>
                <span>{issuanceStatus(issuance, locale)}</span>
                <p>{t.passportAvailable}</p>
              </div>
              <span className={styles.copyResult} aria-live="polite">
                {copyStatus === "copied" ? t.copiedFanId : copyStatus === "failed" ? t.copyFanIdFailed : ""}
              </span>
            </aside>

            <div className={styles.actionRail} aria-live="polite">
              {stage >= 3 ? (
                <div className={styles.completedActions}>
                  <div className={styles.actionLinks}>
                    <Link ref={openPassportRef} className={fanActionClassName("primary", { fullWidth: true, className: styles.openPassport })} href={finalHref}>
                      <span>{finalLabel}</span><ArrowRight aria-hidden="true" />
                    </Link>
                    {liveReturnTo ? <Link className={fanActionClassName("neutral", { fullWidth: true, className: styles.openPassport })} href={passportHref}>
                      <span>{t.open}</span><ArrowRight aria-hidden="true" />
                    </Link> : null}
                  </div>
                  <p className={styles.revisitHint}>{t.myHint} <Link href={withLocale("/my", locale)}>{t.openMy}</Link></p>
                </div>
              ) : (
                <span className={styles.actionStatus}>{t.waiting}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
    </FocusFlowFrame>
  );
}

type ScreenState =
  | { kind: "loading" }
  | { kind: "auth" }
  | { kind: "error" }
  | { kind: "ready"; issuance: IssuanceAggregate };

export function PassportIssuanceScreen({ passportId }: { passportId: string }) {
  const params = useSearchParams();
  const locale = localeFrom(params.get("locale"));
  const liveReturnTo = sanitizeLiveReturnTo(params.get("returnTo"));
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [state, setState] = useState<ScreenState>({ kind: "loading" });
  const t = copy[locale];

  const load = useCallback(async () => {
    if (!ready) return;
    if (!authenticated) {
      setState({ kind: "auth" });
      return;
    }
    setState({ kind: "loading" });
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing access token");
      const response = await fetch(`/api/passports/${encodeURIComponent(passportId)}/issuance?locale=${locale}`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("issuance unavailable");
      const body = await response.json() as { issuance?: unknown };
      setState({ kind: "ready", issuance: parseIssuanceAggregate(body.issuance) });
    } catch {
      setState({ kind: "error" });
    }
  }, [authenticated, getAccessToken, locale, passportId, ready]);

  useEffect(() => { void load(); }, [load]);

  if (state.kind === "ready") return <PassportIssuanceCeremony issuance={state.issuance} locale={locale} returnTo={liveReturnTo} />;
  const issuanceQuery = new URLSearchParams({ locale });
  if (liveReturnTo) issuanceQuery.set("returnTo", liveReturnTo);
  return (
    <FocusFlowFrame locale={locale} mainId="passport-issuance-state-main">
      <main className={styles.screen} id="passport-issuance-state-main" tabIndex={-1}>
        <div className={styles.state} role="status" aria-live="polite" aria-busy={state.kind === "loading"}>
        {state.kind === "loading" ? (
          <><h1>{t.loadingTitle}</h1><p>{t.loadingBody}</p></>
        ) : state.kind === "auth" ? (
          <>
            <h1>{t.authTitle}</h1>
            <p>{t.authBody}</p>
            <AuthIntentLink className={fanActionClassName("primary")} emphasis="primary" locale={locale} input={{ sourcePath: `/passports/${passportId}/issuance`, sourceQuery: `?${issuanceQuery.toString()}`, actionType: "OPEN_PASSPORT", targetType: "passport", targetId: passportId }}>{t.authAction}</AuthIntentLink>
          </>
        ) : (
          <>
            <h1>{t.errorTitle}</h1>
            <p>{t.errorBody}</p>
            <FanAction variant="neutral" onClick={() => void load()} leadingIcon={<RotateCcw />}>{t.retry}</FanAction>
            <FanAction variant="passport" href={withLocale(`/passports/${passportId}`, locale)} trailingIcon={<ArrowRight />}>{t.open}</FanAction>
          </>
        )}
        </div>
      </main>
    </FocusFlowFrame>
  );
}
