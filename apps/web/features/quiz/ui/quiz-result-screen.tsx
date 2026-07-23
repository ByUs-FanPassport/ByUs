"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { usePrivy } from "@privy-io/react-auth";
import { Check, Info, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { parseQuizAttemptProjection, parseQuizStartProjection, type QuizAttemptProjection } from "../domain/quiz-attempt";
import styles from "./quiz-result-screen.module.css";

interface QuizResultScreenProps {
  attemptId: string | null;
  passportId: string | null;
  celebritySlug: string;
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

function ResultHeader() {
  return (
    <header className={styles.header}>
      <Link className={styles.wordmark} href="/" aria-label="ByUs 홈">
        <Image src="/images/guest-home/byus-wordmark.svg" alt="ByUs" width={80} height={30} priority />
      </Link>
      <nav aria-label="언어"><strong>KO</strong><span aria-hidden="true" /><span>EN</span></nav>
    </header>
  );
}

export function QuizResultScreen({ attemptId, passportId, celebritySlug }: QuizResultScreenProps) {
  const router = useRouter();
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

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
        const body = await parseJson(await fetch(`/api/quiz-attempts/${attemptId}?locale=ko`, {
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
  }, [attemptId, authenticated, getAccessToken, passportId, ready]);

  async function retry() {
    if (actionPending) return;
    setActionPending(true);
    setActionError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing access token");
      const body = await parseJson(await fetch(`/api/celebrities/${celebritySlug}/quiz/attempts?locale=ko`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      })) as { result?: unknown };
      const result = parseQuizStartProjection(body.result);
      if (result.kind === "holder") {
        router.push(`/passports/${result.passportId}` as Route);
      } else {
        router.push(`/c/${celebritySlug}/verify/questions?attempt=${result.attempt.id}` as Route);
      }
    } catch {
      setActionError("새 퀴즈를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.");
      setActionPending(false);
    }
  }

  const celebrityName = celebritySlug.replaceAll("-", " ").toUpperCase();
  const resultQuery = new URLSearchParams();
  if (attemptId) resultQuery.set("attempt", attemptId);
  if (passportId) resultQuery.set("passport", passportId);
  const resultReturnTo = `/c/${celebritySlug}/verify/result?${resultQuery.toString()}`;

  if (view.kind === "loading") {
    return <main className={styles.page}><ResultHeader /><div className={styles.skeleton} aria-label="퀴즈 결과 불러오는 중" /></main>;
  }
  if (view.kind === "unauthenticated") {
    return (
      <main className={styles.page}>
        <ResultHeader />
        <section className={styles.error}>
          <h1>로그인이 필요해요.</h1>
          <p>팬 인증 결과와 발급된 Passport를 안전하게 확인하려면 로그인해 주세요.</p>
          <Link className={styles.loginAction} href={`/login?returnTo=${encodeURIComponent(resultReturnTo)}&intent=passport` as Route}>
            로그인하고 결과 확인하기
          </Link>
        </section>
      </main>
    );
  }
  if (view.kind === "error") {
    return (
      <main className={styles.page}>
        <ResultHeader />
        <section className={styles.error} role="alert">
          <h1>결과 정보를 확인할 수 없어요.</h1>
          <p>퀴즈 결과 링크를 다시 확인하거나 팬페이지에서 새로 시작해 주세요.</p>
          <Link href={`/c/${celebritySlug}`}>{celebrityName} 팬페이지로 돌아가기</Link>
        </section>
      </main>
    );
  }

  const { attempt } = view.projection;
  const passed = attempt.status === "passed";
  return (
    <main className={styles.page}>
      <ResultHeader />
      <section className={styles.result}>
        <div className={styles.resultIcon} aria-hidden="true">
          {passed ? <Check /> : <RefreshCw />}
        </div>
        <h1>{passed ? `${celebrityName} Official Fan 인증 완료` : "조금만 더 알아보고 다시 도전해 볼까요?"}</h1>
        <p className={passed ? styles.scorePass : styles.score}>{`3문항 중 ${attempt.score}문항을 맞혔어요.`}</p>
        {passed ? (
          <>
            <p className={styles.helper}>팬 인증이 완료되어 {celebrityName} 팬 Passport가 발급되었어요.<br />버튼을 누르면 첫 Stamp와 Passport를 확인할 수 있어요.</p>
            <div className={styles.rewards}>
              <div><span>Passport</span><strong>{celebrityName} Passport</strong><small>발급 완료</small></div>
              <div><span>Stamp</span><strong>Knowledge Stamp</strong><small>적립 완료</small></div>
              <div><span>Score</span><strong>팬 점수 +1</strong><small>반영 완료</small></div>
            </div>
            <Link className={styles.primary} href={`/passports/${passportId}/issuance` as Route}>Passport 받기</Link>
          </>
        ) : (
          <>
            <p className={styles.helper}>정답과 해설은 공개하지 않아요. 새 문항으로 다시 도전할 수 있습니다.</p>
            <button className={styles.primary} type="button" disabled={actionPending} onClick={() => void retry()}>
              {actionPending ? "새 문항 준비 중" : "다시 도전"}
            </button>
          </>
        )}
        <Link className={styles.secondary} href={`/c/${celebritySlug}`}>{celebrityName} 팬페이지로 돌아가기</Link>
        {!passed && <p className={styles.note}><Info aria-hidden="true" />재도전 횟수와 시간 제한은 없습니다.</p>}
        {actionError && <p className={styles.actionError} role="alert">{actionError}</p>}
      </section>
    </main>
  );
}
