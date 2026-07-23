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
import { FocusFlowBrand } from "@/components/fan-shell/focus-flow-brand";
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

async function readJson(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const code = (body as ApiErrorBody | null)?.error?.code ?? "QUIZ_UNAVAILABLE";
    throw new QuizUiError(code);
  }
  return body;
}

function errorMessage(error: unknown): string {
  if (error instanceof QuizUiError) {
    if (error.code === "UNAUTHENTICATED") return "로그인이 만료되었어요. 다시 로그인한 뒤 이어서 참여해 주세요.";
    if (error.code === "ATTEMPT_CLOSED") return "이미 제출된 퀴즈예요. 결과 화면에서 인증 결과를 확인해 주세요.";
    if (error.code === "WALLET_REQUIRED") return "Passport를 발급할 지갑을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.";
    if (error.code === "ATTEMPT_INCOMPLETE") return "저장되지 않은 답변이 있어요. 세 문항을 다시 확인해 주세요.";
    if (error.code === "QUIZ_UNAVAILABLE" || error.code === "NOT_FOUND") return "현재 참여할 수 있는 팬 인증 퀴즈가 없어요.";
  }
  return "퀴즈 정보를 안전하게 불러오지 못했어요. 잠시 후 다시 시도해 주세요.";
}

function authorization(token: string): HeadersInit {
  return { authorization: `Bearer ${token}` };
}

export function QuizQuestionsScreen({ slug }: { slug: string }) {
  const router = useRouter();
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [screen, setScreen] = useState<ScreenState>({ kind: "loading" });
  const [questionIndex, setQuestionIndex] = useState(0);
  const [savingQuestionId, setSavingQuestionId] = useState<string | null>(null);
  const [submitPending, setSubmitPending] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const requestGeneration = useRef(0);

  const resultPath = useCallback((attemptId: string, passportId?: string) => {
    const query = new URLSearchParams({ attempt: attemptId });
    if (passportId) query.set("passport", passportId);
    return `/c/${slug}/verify/result?${query.toString()}` as Route;
  }, [slug]);

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setScreen({ kind: "loading" });
    setOperationError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new QuizUiError("UNAUTHENTICATED");
      const response = await fetch(`/api/celebrities/${encodeURIComponent(slug)}/quiz/attempts?locale=ko`, {
        method: "POST",
        headers: authorization(token),
        cache: "no-store",
      });
      const body = await readJson(response) as { result?: unknown };
      const result = parseQuizStartProjection(body.result);
      if (generation !== requestGeneration.current) return;
      if (result.kind === "holder") {
        router.replace(`/passports/${result.passportId}` as Route);
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
      if (generation === requestGeneration.current) setScreen({ kind: "error", message: errorMessage(error) });
    }
  }, [getAccessToken, resultPath, router, slug]);

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

  const saveAnswer = useCallback(async (questionId: string, selectedOptionId: string) => {
    if (!projection || savingQuestionId || submitPending) return;
    setSavingQuestionId(questionId);
    setOperationError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new QuizUiError("UNAUTHENTICATED");
      const response = await fetch(`/api/quiz-attempts/${projection.attempt.id}/answers?locale=ko`, {
        method: "PUT",
        headers: { ...authorization(token), "content-type": "application/json" },
        body: JSON.stringify({ questionId, selectedOptionId }),
        cache: "no-store",
      });
      const body = await readJson(response) as { attempt?: unknown };
      const nextProjection = parseQuizAttemptProjection(body.attempt);
      setScreen({ kind: "ready", projection: nextProjection });
    } catch (error) {
      setOperationError(errorMessage(error));
    } finally {
      setSavingQuestionId(null);
    }
  }, [getAccessToken, projection, savingQuestionId, submitPending]);

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
      setOperationError(errorMessage(error));
      setSubmitPending(false);
    }
  }, [allAnswered, getAccessToken, projection, resultPath, router, savingQuestionId, submitPending]);

  if (!ready || (authenticated && screen.kind === "loading")) {
    return <QuizFrame><div className={styles.loading} role="status" aria-label="팬 인증 퀴즈 불러오는 중"><span /><span /><span /><p>팬 인증 퀴즈를 불러오고 있어요.</p></div></QuizFrame>;
  }

  if (!authenticated) {
    const returnTo = `/c/${slug}/verify/questions`;
    return <QuizFrame><section className={styles.message} aria-labelledby="login-required"><h1 id="login-required">로그인이 필요해요.</h1><p>팬 인증 답변을 안전하게 저장하고 이어서 참여하려면 로그인해 주세요.</p><Link className={styles.primaryAction} href={`/login?returnTo=${encodeURIComponent(returnTo)}&intent=passport` as Route}>로그인하고 계속하기 <ArrowRight /></Link></section></QuizFrame>;
  }

  if (screen.kind === "error") {
    return <QuizFrame><section className={styles.message} role="alert"><h1>퀴즈를 불러오지 못했어요.</h1><p>{screen.message}</p><button className={styles.secondaryAction} type="button" onClick={() => void load()}><RotateCcw /> 다시 시도</button></section></QuizFrame>;
  }

  if (!question || !projection) return null;

  const isSaving = savingQuestionId === question.id;
  const isLast = questionIndex === projection.questions.length - 1;
  const canContinue = question.selectedOptionId !== null && !savingQuestionId && !submitPending;

  return (
    <QuizFrame>
      <section className={styles.quiz} aria-labelledby="question-heading">
        <header className={styles.quizHeader}>
          <div><p>팬 인증 퀴즈</p><h1>KARA를 얼마나 알고 있나요?</h1></div>
          <strong aria-label={`총 3문항 중 ${questionIndex + 1}번째`}>{questionIndex + 1} / 3</strong>
        </header>
        <div className={styles.progress} aria-hidden="true"><span style={{ transform: `scaleX(${(questionIndex + 1) / 3})` }} /></div>
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
          {isSaving ? "답변 저장 중…" : question.selectedOptionId ? "답변 저장 완료" : "답을 선택해 주세요."}
        </div>
        {operationError && <div className={styles.inlineError} role="alert"><p>{operationError} 답을 다시 선택해 주세요.</p></div>}
        <nav className={styles.navigation} aria-label="퀴즈 문항 이동">
          <button className={styles.previous} type="button" disabled={questionIndex === 0 || Boolean(savingQuestionId) || submitPending} onClick={() => setQuestionIndex((index) => index - 1)}><ArrowLeft /> 이전 질문</button>
          {isLast ? (
            <button className={styles.submit} type="button" disabled={!allAnswered || Boolean(savingQuestionId) || submitPending} onClick={() => void submit()}>{submitPending ? "결과 확인 중…" : "팬 인증 결과 확인"}<ArrowRight /></button>
          ) : (
            <button className={styles.next} type="button" disabled={!canContinue} onClick={() => setQuestionIndex((index) => index + 1)}>다음 질문 <ArrowRight /></button>
          )}
        </nav>
      </section>
    </QuizFrame>
  );
}

function QuizFrame({ children }: { children: React.ReactNode }) {
  return <main className={styles.page}><FocusFlowBrand /><div className={styles.shell}>{children}</div></main>;
}
