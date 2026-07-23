"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowRight, Check, RotateCcw } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { parseQuizStartProjection } from "../domain/quiz-attempt";
import { parsePublicQuizIntro, type PublicQuizIntro } from "../domain/quiz-intro";
import { consumeAuthIntent, readAuthIntent } from "@/components/auth-intent";
import { AuthIntentLink } from "@/components/auth-intent-link";
import { FocusFlowBrand } from "@/components/fan-shell/focus-flow-brand";
import styles from "./quiz-entry-screen.module.css";

type ScreenState =
  | { kind: "loading" }
  | { kind: "ready"; intro: PublicQuizIntro }
  | { kind: "error"; message: string };

type ApiErrorBody = { error?: { code?: string } };

class QuizEntryError extends Error {
  constructor(readonly code: string) { super(code); }
}

async function readJson(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new QuizEntryError((body as ApiErrorBody | null)?.error?.code ?? "QUIZ_UNAVAILABLE");
  }
  return body;
}

function errorMessage(error: unknown): string {
  if (error instanceof QuizEntryError) {
    if (error.code === "UNAUTHENTICATED") return "로그인이 만료되었어요. 다시 로그인한 뒤 참여해 주세요.";
    if (error.code === "NOT_FOUND" || error.code === "QUIZ_UNAVAILABLE") return "현재 참여할 수 있는 팬 인증 퀴즈가 없어요.";
  }
  return "팬 인증 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.";
}

export function QuizEntryScreen({ slug }: { slug: string }) {
  const router = useRouter();
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [screen, setScreen] = useState<ScreenState>({ kind: "loading" });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const resumedIntentRef = useRef<string | null>(null);

  const loadIntro = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setScreen({ kind: "loading" });
    try {
      const response = await fetch(`/api/public/celebrities/${encodeURIComponent(slug)}/quiz?locale=ko`, {
        method: "GET",
        cache: "no-store",
      });
      const body = await readJson(response) as { intro?: unknown };
      const intro = parsePublicQuizIntro(body.intro);
      if (generation === requestGeneration.current) setScreen({ kind: "ready", intro });
    } catch (error) {
      if (generation === requestGeneration.current) setScreen({ kind: "error", message: errorMessage(error) });
    }
  }, [slug]);

  useEffect(() => {
    void loadIntro();
    return () => { requestGeneration.current += 1; };
  }, [loadIntro]);

  const start = useCallback(async () => {
    if (!ready || !authenticated || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new QuizEntryError("UNAUTHENTICATED");
      const response = await fetch(`/api/celebrities/${encodeURIComponent(slug)}/quiz/attempts?locale=ko`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const body = await readJson(response) as { result?: unknown };
      const result = parseQuizStartProjection(body.result);
      const intentId = new URLSearchParams(window.location.search).get("authIntent");
      const intent = readAuthIntent(window.sessionStorage, intentId);
      if (intent?.actionType === "START_FAN_VERIFICATION" && intent.targetType === "celebrity" && intent.targetId === slug) {
        consumeAuthIntent(window.sessionStorage, intent.id);
      }
      if (result.kind === "holder") {
        router.push(`/passports/${result.passportId}` as Route);
        return;
      }
      if (result.attempt.status !== "open") {
        router.push(`/c/${slug}/verify/result?attempt=${result.attempt.id}` as Route);
        return;
      }
      router.push(`/c/${slug}/verify/questions?attempt=${result.attempt.id}` as Route);
    } catch (error) {
      setStartError(errorMessage(error));
      setStarting(false);
    }
  }, [authenticated, getAccessToken, ready, router, slug, starting]);

  useEffect(() => {
    if (!authenticated || screen.kind !== "ready" || screen.intro.quiz.availability !== "available") return;
    const intentId = new URLSearchParams(window.location.search).get("authIntent");
    if (!intentId || resumedIntentRef.current === intentId) return;
    const intent = readAuthIntent(window.sessionStorage, intentId);
    if (intent?.actionType !== "START_FAN_VERIFICATION" || intent.targetType !== "celebrity" || intent.targetId !== slug) return;
    resumedIntentRef.current = intentId;
    void start();
  }, [authenticated, screen, slug, start]);

  return (
    <main className={styles.page}>
      <FocusFlowBrand />
      <div className={styles.shell}>
        {screen.kind === "loading" && (
          <div className={styles.loading} role="status" aria-label="팬 인증 정보 불러오는 중">
            <span /><span /><span /><p>팬 인증을 준비하고 있어요.</p>
          </div>
        )}
        {screen.kind === "error" && (
          <section className={styles.message} role="alert">
            <h1>팬 인증을 준비하지 못했어요.</h1><p>{screen.message}</p>
            <button className={styles.secondaryAction} type="button" onClick={() => void loadIntro()}><RotateCcw /> 다시 시도</button>
          </section>
        )}
        {screen.kind === "ready" && screen.intro.quiz.availability === "unavailable" && (
          <section className={styles.message}>
            <h1>아직 팬 인증 퀴즈가 준비되지 않았어요.</h1>
            <p>{screen.intro.celebrity.name}의 새 팬 인증이 열리면 다시 참여해 주세요.</p>
            <Link className={styles.secondaryAction} href={`/c/${slug}` as Route}>팬페이지로 돌아가기</Link>
          </section>
        )}
        {screen.kind === "ready" && screen.intro.quiz.availability === "available" && (
          <section className={styles.entry} aria-labelledby="quiz-entry-heading">
            <header><p>Official Fan 인증</p><h1 id="quiz-entry-heading">{screen.intro.celebrity.name}를 향한<br />나의 팬심을 확인해 보세요.</h1></header>
            <p className={styles.description}>간단한 퀴즈를 통과하면 첫 Knowledge Stamp와 Fan Passport를 받을 수 있어요.</p>
            <ul className={styles.facts}>
              <li><Check aria-hidden="true" /><span><strong>{screen.intro.quiz.totalQuestions}문항</strong>으로 팬심 확인</span></li>
              <li><Check aria-hidden="true" /><span><strong>{screen.intro.quiz.passThreshold}문항 이상</strong> 정답이면 인증 완료</span></li>
              <li><Check aria-hidden="true" /><span>답변은 문항마다 안전하게 저장</span></li>
            </ul>
            {!ready ? (
              <button className={styles.primaryAction} type="button" disabled>로그인 확인 중…</button>
            ) : authenticated ? (
              <button className={styles.primaryAction} type="button" disabled={starting} onClick={() => void start()}>{starting ? "팬 인증 시작 중…" : "팬 인증 시작하기"}<ArrowRight /></button>
            ) : (
              <AuthIntentLink className={styles.primaryAction} locale="ko" input={{ sourcePath: `/c/${slug}/verify`, sourceQuery: "", actionType: "START_FAN_VERIFICATION", targetType: "celebrity", targetId: slug }}>로그인하고 시작하기 <ArrowRight /></AuthIntentLink>
            )}
            {startError && <p className={styles.inlineError} role="alert">{startError}</p>}
            <p className={styles.note}>이미 시작한 인증이 있다면 저장된 문항부터 이어서 진행됩니다.</p>
          </section>
        )}
      </div>
    </main>
  );
}
