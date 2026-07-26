"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { usePrivy } from "@privy-io/react-auth";
import { Check, Info, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { parseQuizAttemptProjection, parseQuizStartProjection, type QuizAttemptProjection } from "../domain/quiz-attempt";
import type { FanLocale } from "@/components/fan-shell/fan-app-shell";
import { FocusFlowFrame } from "@/components/fan-shell/focus-flow-frame";
import { FanAction } from "@/components/fan-ui/fan-action";
import styles from "./quiz-result-screen.module.css";

interface QuizResultScreenProps {
  attemptId: string | null;
  passportId: string | null;
  celebritySlug: string;
  celebrityName?: string;
  locale: FanLocale;
}

type ViewState =
  | { kind: "loading" }
  | { kind: "unauthenticated" }
  | { kind: "error" }
  | { kind: "ready"; projection: QuizAttemptProjection };

async function parseJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error("request failed");
  return response.json();
}

const copy = {
  ko: {
    favorite: "최애",
    loginTitle: "로그인이 필요해요.",
    loginBody: "팬 인증 결과와 발급된 Passport를 안전하게 확인하려면 로그인해 주세요.",
    login: "로그인하고 결과 확인하기",
    errorTitle: "결과 정보를 확인할 수 없어요.",
    errorBody: "퀴즈 결과 링크를 다시 확인하거나 팬페이지에서 새로 시작해 주세요.",
    fanPage: (name: string) => `${name} 팬페이지로 돌아가기`,
    completionAria: "팬 인증 3단계 중 3단계 완료",
    completion: "팬 인증 · 3 / 3",
    passed: (name: string) => `${name} Official Fan 인증 완료`,
    failed: "조금만 더 알아보고 다시 도전해 볼까요?",
    score: (score: number) => `3문항 중 ${score}문항을 맞혔어요.`,
    passedHelper: (name: string) => `팬 인증이 완료되어 ${name} 팬 Passport가 발급되었어요.`,
    passedActionHelper: "버튼을 누르면 첫 Stamp와 Passport를 확인할 수 있어요.",
    issued: "발급 완료",
    earned: "적립 완료",
    applied: "반영 완료",
    fanScore: "팬 점수 +1",
    receivePassport: "Passport 받기",
    failedHelper: "정답과 해설은 공개하지 않아요. 새 문항으로 다시 도전할 수 있습니다.",
    retrying: "새 문항 준비 중",
    retry: "다시 도전",
    retryNote: "재도전 횟수와 시간 제한은 없습니다.",
    retryError: "새 퀴즈를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.",
  },
  en: {
    favorite: "your favorite",
    loginTitle: "Sign in required",
    loginBody: "Sign in to securely view your fan verification result and issued Passport.",
    login: "Sign in to view result",
    errorTitle: "We couldn't verify this result.",
    errorBody: "Check the quiz result link or start again from the fan page.",
    fanPage: (name: string) => `Back to ${name} fan page`,
    completionAria: "Fan verification step 3 of 3 complete",
    completion: "Fan verification · 3 / 3",
    passed: (name: string) => `${name} Official Fan verification complete`,
    failed: "Almost there. Ready to try again?",
    score: (score: number) => `You answered ${score} of 3 questions correctly.`,
    passedHelper: (name: string) => `Your ${name} Fan Passport was issued after verification.`,
    passedActionHelper: "Open it to see your first Stamp and Passport.",
    issued: "Issued",
    earned: "Earned",
    applied: "Applied",
    fanScore: "Fan Score +1",
    receivePassport: "Open Passport",
    failedHelper: "Answers and explanations aren't shown. You can retry with new questions.",
    retrying: "Preparing new questions",
    retry: "Try again",
    retryNote: "There is no retry count or time limit.",
    retryError: "We couldn't start a new quiz. Please try again in a moment.",
  },
} as const;

function withLocale(path: string, locale: FanLocale): Route {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}locale=${locale}` as Route;
}

function ResultFrame({ children, locale }: { children: React.ReactNode; locale: FanLocale }) {
  return (
    <FocusFlowFrame locale={locale} mainId="fan-verification-result-main">
      <main className={styles.page} id="fan-verification-result-main" tabIndex={-1}>
        {children}
      </main>
    </FocusFlowFrame>
  );
}

export function QuizResultScreen({
  attemptId,
  passportId,
  celebritySlug,
  celebrityName,
  locale,
}: QuizResultScreenProps) {
  const router = useRouter();
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const actionErrorRef = useRef<HTMLParagraphElement>(null);
  const t = copy[locale];
  const displayName = celebrityName ?? t.favorite;

  useEffect(() => {
    if (actionError) actionErrorRef.current?.focus();
  }, [actionError]);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      setView({ kind: "unauthenticated" });
      return;
    }
    if (!attemptId) {
      setView({ kind: "error" });
      return;
    }
    let active = true;
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("missing access token");
        const body = await parseJson(await fetch(`/api/quiz-attempts/${attemptId}?locale=${locale}`, {
          method: "GET",
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        })) as { attempt?: unknown };
        const projection = parseQuizAttemptProjection(body.attempt);
        const resultMatchesRoute = passportId === null
          ? projection.attempt.status === "failed"
          : projection.attempt.status === "passed";
        if (!resultMatchesRoute) throw new Error("result route mismatch");
        if (active) setView({ kind: "ready", projection });
      } catch {
        if (active) setView({ kind: "error" });
      }
    })();
    return () => { active = false; };
  }, [attemptId, authenticated, getAccessToken, locale, passportId, ready]);

  async function retry() {
    if (actionPending) return;
    setActionPending(true);
    setActionError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing access token");
      const body = await parseJson(await fetch(`/api/celebrities/${celebritySlug}/quiz/attempts?locale=${locale}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      })) as { result?: unknown };
      const result = parseQuizStartProjection(body.result);
      if (result.kind === "holder") {
        router.push(withLocale(`/passports/${result.passportId}`, locale));
      } else {
        router.push(withLocale(`/c/${celebritySlug}/verify/questions?attempt=${result.attempt.id}`, locale));
      }
    } catch {
      setActionError(t.retryError);
      setActionPending(false);
    }
  }

  const resultQuery = new URLSearchParams();
  if (attemptId) resultQuery.set("attempt", attemptId);
  if (passportId) resultQuery.set("passport", passportId);
  resultQuery.set("locale", locale);
  const resultReturnTo = `/c/${celebritySlug}/verify/result?${resultQuery.toString()}`;

  if (view.kind === "loading") {
    return <ResultFrame locale={locale}><div className={styles.skeleton} aria-label={locale === "ko" ? "퀴즈 결과 불러오는 중" : "Loading quiz result"} /></ResultFrame>;
  }
  if (view.kind === "unauthenticated") {
    return (
      <ResultFrame locale={locale}>
        <section className={styles.error}>
          <h1>{t.loginTitle}</h1>
          <p>{t.loginBody}</p>
          <FanAction className={styles.resultAction} variant="primary" href={`/login?returnTo=${encodeURIComponent(resultReturnTo)}&locale=${locale}&intent=passport` as Route}>
            {t.login}
          </FanAction>
        </section>
      </ResultFrame>
    );
  }
  if (view.kind === "error") {
    return (
      <ResultFrame locale={locale}>
        <section className={styles.error} role="alert">
          <h1>{t.errorTitle}</h1>
          <p>{t.errorBody}</p>
          <Link href={withLocale(`/c/${celebritySlug}`, locale)}>{t.fanPage(displayName)}</Link>
        </section>
      </ResultFrame>
    );
  }

  const { attempt } = view.projection;
  if (attempt.status === "open") {
    return (
      <ResultFrame locale={locale}>
        <section className={styles.error} role="alert">
          <h1>{t.errorTitle}</h1>
          <p>{t.errorBody}</p>
          <Link href={withLocale(`/c/${celebritySlug}`, locale)}>{t.fanPage(displayName)}</Link>
        </section>
      </ResultFrame>
    );
  }
  const passed = attempt.status === "passed";
  return (
    <ResultFrame locale={locale}>
      <section className={styles.result}>
        <p className={styles.completion} aria-label={t.completionAria}>{t.completion}</p>
        <div className={styles.resultIcon} aria-hidden="true">
          {passed ? <Check /> : <RefreshCw />}
        </div>
        <h1>{passed ? t.passed(displayName) : t.failed}</h1>
        <p className={passed ? styles.scorePass : styles.score}>{t.score(attempt.score)}</p>
        {passed ? (
          <>
            <p className={styles.helper}>{t.passedHelper(displayName)}<br />{t.passedActionHelper}</p>
            <div className={styles.rewards}>
              <div><span>Passport</span><strong>{displayName} Passport</strong><small>{t.issued}</small></div>
              <div><span>Stamp</span><strong>Knowledge Stamp</strong><small>{t.earned}</small></div>
              <div><span>Score</span><strong>{t.fanScore}</strong><small>{t.applied}</small></div>
            </div>
            <FanAction className={styles.resultAction} variant="primary" href={withLocale(`/passports/${passportId}/issuance`, locale)}>
              {t.receivePassport}
            </FanAction>
          </>
        ) : (
          <>
            <p className={styles.helper}>{t.failedHelper}</p>
            <FanAction className={styles.resultAction} variant="primary" disabled={actionPending} ariaBusy={actionPending} onClick={() => void retry()}>
              {actionPending ? t.retrying : t.retry}
            </FanAction>
          </>
        )}
        <Link className={styles.secondary} href={withLocale(`/c/${celebritySlug}`, locale)}>{t.fanPage(displayName)}</Link>
        {!passed && <p className={styles.note}><Info aria-hidden="true" />{t.retryNote}</p>}
        {actionError && <p ref={actionErrorRef} className={styles.actionError} role="alert" tabIndex={-1}>{actionError}</p>}
      </section>
    </ResultFrame>
  );
}
