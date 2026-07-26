"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowLeft, ArrowRight, Check, RotateCcw } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  parseQuizAttemptProjection,
  parseQuizStartProjection,
  parseQuizSubmitProjection,
  type QuizAttemptProjection,
} from "../domain/quiz-attempt";
import type { FanLocale } from "@/components/fan-shell/fan-app-shell";
import { FocusFlowFrame } from "@/components/fan-shell/focus-flow-frame";
import { FanAction } from "@/components/fan-ui/fan-action";
import styles from "./quiz-questions-screen.module.css";

type ScreenState =
  | { kind: "loading" }
  | { kind: "ready"; projection: QuizAttemptProjection }
  | { kind: "error"; message: string };

type ApiErrorBody = { error?: { code?: string } };

class QuizUiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const copy = {
  ko: {
    sessionExpired: "로그인이 만료되었어요. 다시 로그인한 뒤 이어서 참여해 주세요.",
    closed: "이미 제출된 퀴즈예요. 결과 화면에서 인증 결과를 확인해 주세요.",
    wallet: "Passport를 발급할 지갑을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.",
    incomplete: "저장되지 않은 답변이 있어요. 세 문항을 다시 확인해 주세요.",
    unavailable: "현재 참여할 수 있는 팬 인증 퀴즈가 없어요.",
    loadError: "퀴즈 정보를 안전하게 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
    loadingAria: "팬 인증 퀴즈 불러오는 중",
    loading: "팬 인증 퀴즈를 불러오고 있어요.",
    loginTitle: "로그인이 필요해요.",
    loginBody: "팬 인증 답변을 안전하게 저장하고 이어서 참여하려면 로그인해 주세요.",
    login: "로그인하고 계속하기",
    errorTitle: "퀴즈를 불러오지 못했어요.",
    retry: "다시 시도",
    exit: "인증을 나가고 팬페이지로 돌아가기",
    eyebrow: "팬 인증 퀴즈",
    title: "최애를 얼마나 알고 있나요?",
    progress: "팬 인증 진행률",
    progressValue: (current: number, total: number) => `총 ${total}문항 중 ${current}번째`,
    saving: "답변 저장 중…",
    saved: "답변 저장 완료",
    select: "답을 선택해 주세요.",
    retryAnswer: "답을 다시 선택해 주세요.",
    navigation: "퀴즈 문항 이동",
    previous: "이전 질문",
    submitting: "결과 확인 중…",
    submit: "팬 인증 결과 확인",
    next: "다음 질문",
  },
  en: {
    sessionExpired: "Your sign-in expired. Sign in again to continue.",
    closed: "This quiz was already submitted. Check the result screen for your verification status.",
    wallet: "We couldn't prepare a wallet for your Passport. Please try again in a moment.",
    incomplete: "Some answers weren't saved. Review all three questions.",
    unavailable: "This fan verification quiz is not available right now.",
    loadError: "We couldn't load the quiz securely. Please try again in a moment.",
    loadingAria: "Loading fan verification quiz",
    loading: "Loading your fan verification quiz.",
    loginTitle: "Sign in required",
    loginBody: "Sign in to save your fan verification answers and continue securely.",
    login: "Sign in to continue",
    errorTitle: "We couldn't load the quiz.",
    retry: "Try again",
    exit: "Exit verification and return to the fan page",
    eyebrow: "Fan verification quiz",
    title: "How well do you know your favorite?",
    progress: "Fan verification progress",
    progressValue: (current: number, total: number) => `Question ${current} of ${total}`,
    saving: "Saving answer…",
    saved: "Answer saved",
    select: "Choose an answer.",
    retryAnswer: "Choose the answer again.",
    navigation: "Quiz question navigation",
    previous: "Previous question",
    submitting: "Checking result…",
    submit: "View verification result",
    next: "Next question",
  },
} as const;

function withLocale(path: string, locale: FanLocale): Route {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}locale=${locale}` as Route;
}

async function readJson(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const code = (body as ApiErrorBody | null)?.error?.code ?? "QUIZ_UNAVAILABLE";
    throw new QuizUiError(code);
  }
  return body;
}

function errorMessage(error: unknown, locale: FanLocale): string {
  const t = copy[locale];
  if (error instanceof QuizUiError) {
    if (error.code === "UNAUTHENTICATED") return t.sessionExpired;
    if (error.code === "ATTEMPT_CLOSED") return t.closed;
    if (error.code === "WALLET_REQUIRED") return t.wallet;
    if (error.code === "ATTEMPT_INCOMPLETE") return t.incomplete;
    if (error.code === "QUIZ_UNAVAILABLE" || error.code === "NOT_FOUND") return t.unavailable;
  }
  return t.loadError;
}

function authorization(token: string): HeadersInit {
  return { authorization: `Bearer ${token}` };
}

export function QuizQuestionsScreen({ slug, locale }: { slug: string; locale: FanLocale }) {
  const router = useRouter();
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [screen, setScreen] = useState<ScreenState>({ kind: "loading" });
  const [questionIndex, setQuestionIndex] = useState(0);
  const [savingQuestionId, setSavingQuestionId] = useState<string | null>(null);
  const [submitPending, setSubmitPending] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const operationErrorRef = useRef<HTMLDivElement>(null);
  const t = copy[locale];

  const resultPath = useCallback((attemptId: string, passportId?: string) => {
    const query = new URLSearchParams({ attempt: attemptId });
    if (passportId) query.set("passport", passportId);
    query.set("locale", locale);
    return `/c/${slug}/verify/result?${query.toString()}` as Route;
  }, [locale, slug]);

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setScreen({ kind: "loading" });
    setOperationError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new QuizUiError("UNAUTHENTICATED");
      const response = await fetch(`/api/celebrities/${encodeURIComponent(slug)}/quiz/attempts?locale=${locale}`, {
        method: "POST",
        headers: authorization(token),
        cache: "no-store",
      });
      const body = await readJson(response) as { result?: unknown };
      const result = parseQuizStartProjection(body.result);
      if (generation !== requestGeneration.current) return;
      if (result.kind === "holder") {
        router.replace(withLocale(`/passports/${result.passportId}`, locale));
        return;
      }
      if (result.attempt.status !== "open") {
        router.replace(resultPath(result.attempt.id));
        return;
      }
      setScreen({ kind: "ready", projection: { attempt: result.attempt, questions: result.questions } });
      const firstUnanswered = result.questions.findIndex((question) => question.selectedOptionId === null);
      setQuestionIndex(firstUnanswered === -1 ? 0 : firstUnanswered);
    } catch (error) {
      if (generation === requestGeneration.current) setScreen({ kind: "error", message: errorMessage(error, locale) });
    }
  }, [getAccessToken, locale, resultPath, router, slug]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    void load();
    return () => { requestGeneration.current += 1; };
  }, [authenticated, load, ready]);

  const projection = screen.kind === "ready" ? screen.projection : null;
  const question = projection?.questions[questionIndex] ?? null;
  const allAnswered = useMemo(
    () => projection?.questions.every((item) => item.selectedOptionId !== null) ?? false,
    [projection],
  );

  useEffect(() => {
    if (operationError) operationErrorRef.current?.focus();
  }, [operationError]);

  const saveAnswer = useCallback(async (questionId: string, selectedOptionId: string) => {
    if (!projection || savingQuestionId || submitPending) return;
    setSavingQuestionId(questionId);
    setOperationError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new QuizUiError("UNAUTHENTICATED");
      const response = await fetch(`/api/quiz-attempts/${projection.attempt.id}/answers?locale=${locale}`, {
        method: "PUT",
        headers: { ...authorization(token), "content-type": "application/json" },
        body: JSON.stringify({ questionId, selectedOptionId }),
        cache: "no-store",
      });
      const body = await readJson(response) as { attempt?: unknown };
      const nextProjection = parseQuizAttemptProjection(body.attempt);
      setScreen({ kind: "ready", projection: nextProjection });
    } catch (error) {
      setOperationError(errorMessage(error, locale));
    } finally {
      setSavingQuestionId(null);
    }
  }, [getAccessToken, locale, projection, savingQuestionId, submitPending]);

  const submit = useCallback(async () => {
    if (!projection || !allAnswered || savingQuestionId || submitPending) return;
    setSubmitPending(true);
    setOperationError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new QuizUiError("UNAUTHENTICATED");
      const response = await fetch(`/api/quiz-attempts/${projection.attempt.id}/submit`, {
        method: "POST",
        headers: authorization(token),
        cache: "no-store",
      });
      const body = await readJson(response) as { result?: unknown };
      const result = parseQuizSubmitProjection(body.result);
      router.replace(result.issuance
        ? resultPath(result.attempt.id, result.issuance.passportId)
        : resultPath(result.attempt.id));
    } catch (error) {
      setOperationError(errorMessage(error, locale));
      setSubmitPending(false);
    }
  }, [allAnswered, getAccessToken, locale, projection, resultPath, router, savingQuestionId, submitPending]);

  if (!ready || (authenticated && screen.kind === "loading")) {
    return <QuizFrame locale={locale}><div className={styles.loading} role="status" aria-label={t.loadingAria}><span /><span /><span /><p>{t.loading}</p></div></QuizFrame>;
  }

  if (!authenticated) {
    const returnTo = withLocale(`/c/${slug}/verify/questions`, locale);
    return <QuizFrame locale={locale}><section className={styles.message} aria-labelledby="login-required"><h1 id="login-required">{t.loginTitle}</h1><p>{t.loginBody}</p><FanAction variant="primary" href={`/login?returnTo=${encodeURIComponent(returnTo)}&locale=${locale}&intent=passport` as Route} trailingIcon={<ArrowRight />}>{t.login}</FanAction></section></QuizFrame>;
  }

  if (screen.kind === "error") {
    return <QuizFrame locale={locale}><section className={styles.message} role="alert"><h1>{t.errorTitle}</h1><p>{screen.message}</p><button className={styles.secondaryAction} type="button" onClick={() => void load()}><RotateCcw aria-hidden="true" /> {t.retry}</button></section></QuizFrame>;
  }

  if (!question || !projection) return null;

  const isSaving = savingQuestionId === question.id;
  const isLast = questionIndex === projection.questions.length - 1;
  const canContinue = question.selectedOptionId !== null && !savingQuestionId && !submitPending;
  const totalQuestions = projection.questions.length;

  return (
    <QuizFrame locale={locale}>
      <section className={styles.quiz} aria-labelledby="question-heading">
        <Link className={styles.exitLink} href={withLocale(`/c/${slug}`, locale)}><ArrowLeft aria-hidden="true" />{t.exit}</Link>
        <header className={styles.quizHeader}>
          <div><p>{t.eyebrow}</p><h1>{t.title}</h1></div>
          <strong aria-label={t.progressValue(questionIndex + 1, totalQuestions)}>{questionIndex + 1} / {totalQuestions}</strong>
        </header>
        <div
          className={styles.progress}
          role="progressbar"
          aria-label={t.progress}
          aria-valuemin={1}
          aria-valuemax={totalQuestions}
          aria-valuenow={questionIndex + 1}
        ><span aria-hidden="true" style={{ transform: `scaleX(${(questionIndex + 1) / totalQuestions})` }} /></div>
        <form className={styles.question} onSubmit={(event) => event.preventDefault()}>
          <fieldset disabled={Boolean(savingQuestionId) || submitPending}>
            <legend id="question-heading">{question.prompt}</legend>
            <div className={styles.options}>
              {question.options.map((option) => (
                <label key={option.id} className={styles.option}>
                  <input type="radio" name={question.id} value={option.id} checked={question.selectedOptionId === option.id} onChange={() => void saveAnswer(question.id, option.id)} />
                  <span className={styles.radioMark} aria-hidden="true" />
                  <span>{option.label}</span>
                  <Check aria-hidden="true" />
                </label>
              ))}
            </div>
          </fieldset>
        </form>
        <div className={styles.saveStatus} aria-live="polite">
          {isSaving ? t.saving : question.selectedOptionId ? t.saved : t.select}
        </div>
        {operationError && <div ref={operationErrorRef} className={styles.inlineError} role="alert" tabIndex={-1}><p>{operationError} {t.retryAnswer}</p></div>}
        <nav className={styles.navigation} aria-label={t.navigation}>
          <button className={styles.previous} type="button" disabled={questionIndex === 0 || Boolean(savingQuestionId) || submitPending} onClick={() => setQuestionIndex((index) => index - 1)}><ArrowLeft aria-hidden="true" /> {t.previous}</button>
          {isLast ? (
            <FanAction variant="primary" disabled={!allAnswered || Boolean(savingQuestionId) || submitPending} ariaBusy={submitPending} onClick={() => void submit()} trailingIcon={<ArrowRight />}>{submitPending ? t.submitting : t.submit}</FanAction>
          ) : (
            <FanAction variant="primary" disabled={!canContinue} onClick={() => setQuestionIndex((index) => index + 1)} trailingIcon={<ArrowRight />}>{t.next}</FanAction>
          )}
        </nav>
      </section>
    </QuizFrame>
  );
}

function QuizFrame({ children, locale }: { children: React.ReactNode; locale: FanLocale }) {
  return (
    <FocusFlowFrame locale={locale} mainId="fan-verification-questions-main">
      <main className={styles.page} id="fan-verification-questions-main" tabIndex={-1}>
        <div className={styles.shell}>{children}</div>
      </main>
    </FocusFlowFrame>
  );
}
