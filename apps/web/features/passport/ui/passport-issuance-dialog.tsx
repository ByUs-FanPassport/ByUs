"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, RotateCcw } from "lucide-react";

import { AuthIntentLink } from "@/components/auth-intent-link";
import { FocusFlowFrame } from "@/components/fan-shell/focus-flow-frame";
import { parseIssuanceAggregate, type IssuanceAggregate } from "../domain/issuance-aggregate";
import { levelLabel, type PassportLocale } from "../domain/passport-read-model";
import { PassportStampCanvas } from "./passport-stamp-artwork";
import styles from "./passport-issuance-dialog.module.css";

interface PassportIssuanceCeremonyProps { issuance: IssuanceAggregate }

const copy = {
  ko: {
    skip: "건너뛰기",
    progress: "Passport 발급 과정",
    completeTitle: (name: string) => `${name} Fan Passport 발급 완료`,
    completeBody: "팬 인증이 완료되어 첫 Stamp와 Passport가 이미 발급되었어요.",
    score: "팬 점수",
    stampEarned: "팬 인증 Stamp 획득",
    open: "Passport 열기",
    waiting: "Passport에 첫 기록을 남기고 있어요.",
    mintComplete: "디지털 발급 완료",
    mintChecking: "발급 상태 확인 중",
    mintProcessing: "디지털 발급 확인 중",
    mintPreparing: "디지털 발급 준비 중",
    loadingTitle: "발급된 Passport 확인 중",
    loadingBody: "이미 완료된 팬 인증 결과를 안전하게 불러오고 있어요.",
    authTitle: "로그인이 필요해요.",
    authBody: "내 계정에 이미 발급된 Passport를 확인하려면 로그인해 주세요.",
    authAction: "로그인하고 발급 결과 확인하기",
    errorTitle: "발급 결과를 불러오지 못했어요.",
    errorBody: "이 화면에서는 Passport를 새로 발급하지 않아요. 내 Passport 화면에서 상태를 다시 확인할 수 있어요.",
    retry: "다시 확인",
  },
  en: {
    skip: "Skip",
    progress: "Passport issuance progress",
    completeTitle: (name: string) => `${name} Fan Passport issued`,
    completeBody: "Fan verification is complete. Your first Stamp and Passport have been issued.",
    score: "Fan Score",
    stampEarned: "Fan Verification Stamp earned",
    open: "Open Passport",
    waiting: "Adding your first record to the Passport.",
    mintComplete: "Digital issuance complete",
    mintChecking: "Checking issuance status",
    mintProcessing: "Confirming digital issuance",
    mintPreparing: "Preparing digital issuance",
    loadingTitle: "Checking your issued Passport",
    loadingBody: "Loading the fan verification result that has already been completed.",
    authTitle: "Sign in required",
    authBody: "Sign in to view the Passport already issued to your account.",
    authAction: "Sign in and view issuance",
    errorTitle: "We couldn’t load the issuance result.",
    errorBody: "This screen never issues a new Passport. You can check the existing status from your Passport.",
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

export function PassportIssuanceCeremony({
  issuance,
  locale = "ko",
}: PassportIssuanceCeremonyProps & { locale?: PassportLocale }) {
  const [stage, setStage] = useState(0);
  const t = copy[locale];
  const progress = stage + 1;
  const level = levelLabel(locale, "Bronze");
  const passportHref = withLocale(`/passports/${issuance.passport.id}`, locale);
  const skipRef = useRef<HTMLButtonElement>(null);
  const openPassportRef = useRef<HTMLAnchorElement>(null);
  const focusOpenOnCompletionRef = useRef(false);

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
      window.setTimeout(() => setStage(1), 450),
      window.setTimeout(() => setStage(2), 900),
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
        <div className={styles.content}>
          <section className={styles.passport} aria-labelledby="passport-issuance-title">
            <PassportStampCanvas
              celebrityName={issuance.celebrity.name}
              level={level}
              stamps={[{ type: issuance.firstStamp.type, issuedAt: issuance.firstStamp.issuedAt }]}
              totalCount={1}
              revealCount={stage >= 1 ? 1 : 0}
              locale={locale}
              priority
            />
            <div className={styles.identity}>
              <h1 id="passport-issuance-title">{t.completeTitle(issuance.celebrity.name)}</h1>
              <p>{t.completeBody}</p>
              <dl>
                <div><dt>Celebrity</dt><dd>{issuance.celebrity.name}</dd></div>
                <div><dt>Tier</dt><dd>{level}</dd></div>
              </dl>
            </div>
          </section>

          <aside className={styles.summary} aria-live="polite" aria-atomic="true">
            <div>
              <span>{t.score}</span>
              <strong><s>0</s> <b aria-label={locale === "ko" ? "에서" : "to"}>→</b> {stage >= 2 ? issuance.score.points : 0}</strong>
            </div>
            <p>{stage >= 1 ? t.stampEarned : t.waiting}</p>
            <span className={styles.mintStatus}>{issuanceStatus(issuance, locale)}</span>
          </aside>
        </div>

        <div className={styles.actionRail} aria-live="polite">
          {stage >= 3 ? (
            <Link ref={openPassportRef} className={styles.openPassport} href={passportHref}>
              <span>{t.open}</span><ArrowRight aria-hidden="true" />
            </Link>
          ) : (
            <span className={styles.actionStatus}>{t.waiting}</span>
          )}
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

  if (state.kind === "ready") return <PassportIssuanceCeremony issuance={state.issuance} locale={locale} />;
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
            <AuthIntentLink locale={locale} input={{ sourcePath: `/passports/${passportId}/issuance`, sourceQuery: `?locale=${locale}`, actionType: "OPEN_PASSPORT", targetType: "passport", targetId: passportId }}>{t.authAction}</AuthIntentLink>
          </>
        ) : (
          <>
            <h1>{t.errorTitle}</h1>
            <p>{t.errorBody}</p>
            <button type="button" onClick={() => void load()}><RotateCcw aria-hidden="true" />{t.retry}</button>
            <Link href={withLocale(`/passports/${passportId}`, locale)}>{t.open}<ArrowRight aria-hidden="true" /></Link>
          </>
        )}
        </div>
      </main>
    </FocusFlowFrame>
  );
}
