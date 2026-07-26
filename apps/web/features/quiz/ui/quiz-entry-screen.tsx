"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowLeft, ArrowRight, Check, RotateCcw } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { parseQuizStartProjection } from "../domain/quiz-attempt";
import { parsePublicQuizIntro, type PublicQuizIntro } from "../domain/quiz-intro";
import { consumeAuthIntent, readAuthIntent } from "@/components/auth-intent";
import { AuthIntentLink } from "@/components/auth-intent-link";
import { FocusFlowFrame } from "@/components/fan-shell/focus-flow-frame";
import { FanAction, fanActionClassName } from "@/components/fan-ui/fan-action";
import type { FanLocale } from "@/components/fan-shell/fan-app-shell";
import { appendLoginContext, sanitizeAuthIntentId } from "@/components/login-intent";
import styles from "./quiz-entry-screen.module.css";

type ScreenState =
  | { kind: "loading" }
  | { kind: "ready"; intro: PublicQuizIntro }
  | { kind: "error"; message: string };

type ApiErrorBody = { error?: { code?: string } };

class QuizEntryError extends Error {
  constructor(readonly code: string) { super(code); }
}

const copy = {
  ko: {
    sessionExpired: "로그인이 만료되었어요. 다시 로그인한 뒤 참여해 주세요.",
    unavailable: "현재 참여할 수 있는 팬 인증 퀴즈가 없어요.",
    loadError: "팬 인증 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
    loadingAria: "팬 인증 정보 불러오는 중",
    loading: "팬 인증을 준비하고 있어요.",
    errorTitle: "팬 인증을 준비하지 못했어요.",
    retry: "다시 시도",
    unavailableTitle: "아직 팬 인증 퀴즈가 준비되지 않았어요.",
    unavailableBody: (name: string) => `${name}의 새 팬 인증이 열리면 다시 참여해 주세요.`,
    fanPage: (name?: string) => name ? `${name} 팬페이지로 돌아가기` : "팬페이지로 돌아가기",
    eyebrow: "팬 인증 · 시작 전",
    title: (name: string) => `${name}를 향한\n나의 팬심을 확인해 보세요.`,
    description: "간단한 퀴즈를 통과하면 첫 Knowledge Stamp와 Fan Passport를 받을 수 있어요.",
    questionCount: (count: number) => `${count}문항`,
    questionCountTail: "으로 팬심 확인",
    passThreshold: (count: number) => `${count}문항 이상`,
    passThresholdTail: " 정답이면 인증 완료",
    saved: "답변은 문항마다 안전하게 저장",
    authChecking: "로그인 확인 중…",
    profileChecking: "프로필 확인 중…",
    profileError: "프로필을 확인하지 못했어요.",
    starting: "팬 인증 시작 중…",
    start: "팬 인증 시작하기",
    login: "로그인하고 시작하기",
    note: "이미 시작한 인증이 있다면 저장된 문항부터 이어서 진행됩니다.",
  },
  en: {
    sessionExpired: "Your sign-in expired. Sign in again to continue.",
    unavailable: "This fan verification quiz is not available right now.",
    loadError: "We couldn't load fan verification. Please try again in a moment.",
    loadingAria: "Loading fan verification",
    loading: "Preparing fan verification.",
    errorTitle: "We couldn't prepare fan verification.",
    retry: "Try again",
    unavailableTitle: "The fan verification quiz isn't ready yet.",
    unavailableBody: (name: string) => `Come back when a new ${name} fan verification opens.`,
    fanPage: (name?: string) => name ? `Back to ${name} fan page` : "Back to fan page",
    eyebrow: "Fan verification · Before you begin",
    title: (name: string) => `See how well you know\n${name}.`,
    description: "Pass a short quiz to receive your first Knowledge Stamp and Fan Passport.",
    questionCount: (count: number) => `${count} questions`,
    questionCountTail: " about your favorite",
    passThreshold: (count: number) => `At least ${count} correct`,
    passThresholdTail: " to pass",
    saved: "Each answer is saved securely",
    authChecking: "Checking sign-in…",
    profileChecking: "Checking profile…",
    profileError: "We couldn't check your profile.",
    starting: "Starting fan verification…",
    start: "Start fan verification",
    login: "Sign in to start",
    note: "If you already started, you'll continue from your saved questions.",
  },
} as const;

function withLocale(path: string, locale: FanLocale): Route {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}locale=${locale}` as Route;
}

async function readJson(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new QuizEntryError((body as ApiErrorBody | null)?.error?.code ?? "QUIZ_UNAVAILABLE");
  }
  return body;
}

function errorMessage(error: unknown, locale: FanLocale): string {
  const t = copy[locale];
  if (error instanceof QuizEntryError) {
    if (error.code === "UNAUTHENTICATED") return t.sessionExpired;
    if (error.code === "NOT_FOUND" || error.code === "QUIZ_UNAVAILABLE") return t.unavailable;
  }
  return t.loadError;
}

export function QuizEntryScreen({ slug, locale }: { slug: string; locale: FanLocale }) {
  const router = useRouter();
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [screen, setScreen] = useState<ScreenState>({ kind: "loading" });
  const [starting, setStarting] = useState(false);
  const [profileState, setProfileState] = useState<"idle" | "checking" | "complete" | "error">("idle");
  const [startError, setStartError] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const resumedIntentRef = useRef<string | null>(null);
  const t = copy[locale];

  const loadIntro = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setScreen({ kind: "loading" });
    try {
      const response = await fetch(`/api/public/celebrities/${encodeURIComponent(slug)}/quiz?locale=${locale}`, {
        method: "GET",
        cache: "no-store",
      });
      const body = await readJson(response) as { intro?: unknown };
      const intro = parsePublicQuizIntro(body.intro);
      if (generation === requestGeneration.current) setScreen({ kind: "ready", intro });
    } catch (error) {
      if (generation === requestGeneration.current) setScreen({ kind: "error", message: errorMessage(error, locale) });
    }
  }, [locale, slug]);

  useEffect(() => {
    void loadIntro();
    return () => { requestGeneration.current += 1; };
  }, [loadIntro]);

  useEffect(() => {
    if (!ready || !authenticated) {
      setProfileState("idle");
      return;
    }
    const controller = new AbortController();
    setProfileState("checking");
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new QuizEntryError("UNAUTHENTICATED");
        const response = await fetch("/api/me/profile", {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null) as { profile?: { completed?: boolean } } | null;
        if (!response.ok || !body?.profile) throw new QuizEntryError("PROFILE_UNAVAILABLE");
        if (body.profile.completed) {
          setProfileState("complete");
          return;
        }
        const authIntent = sanitizeAuthIntentId(new URLSearchParams(window.location.search).get("authIntent"));
        const returnQuery = new URLSearchParams({ locale });
        if (authIntent) returnQuery.set("authIntent", authIntent);
        const returnTo = `/c/${slug}/verify?${returnQuery.toString()}`;
        router.replace(appendLoginContext("/onboarding/profile", {
          returnTo,
          intent: "passport",
          entity: slug,
          locale,
          authIntent,
        }) as Route);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setProfileState("error");
      }
    })();
    return () => controller.abort();
  }, [authenticated, getAccessToken, locale, ready, router, slug]);

  const start = useCallback(async () => {
    if (!ready || !authenticated || profileState !== "complete" || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new QuizEntryError("UNAUTHENTICATED");
      const response = await fetch(`/api/celebrities/${encodeURIComponent(slug)}/quiz/attempts?locale=${locale}`, {
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
        router.push(withLocale(`/passports/${result.passportId}`, locale));
        return;
      }
      if (result.attempt.status !== "open") {
        router.push(withLocale(`/c/${slug}/verify/result?attempt=${result.attempt.id}`, locale));
        return;
      }
      router.push(withLocale(`/c/${slug}/verify/questions?attempt=${result.attempt.id}`, locale));
    } catch (error) {
      setStartError(errorMessage(error, locale));
      setStarting(false);
    }
  }, [authenticated, getAccessToken, locale, profileState, ready, router, slug, starting]);

  useEffect(() => {
    if (!authenticated || profileState !== "complete" || screen.kind !== "ready" || screen.intro.quiz.availability !== "available") return;
    const intentId = new URLSearchParams(window.location.search).get("authIntent");
    if (!intentId || resumedIntentRef.current === intentId) return;
    const intent = readAuthIntent(window.sessionStorage, intentId);
    if (intent?.actionType !== "START_FAN_VERIFICATION" || intent.targetType !== "celebrity" || intent.targetId !== slug) return;
    resumedIntentRef.current = intentId;
    void start();
  }, [authenticated, profileState, screen, slug, start]);

  return (
    <FocusFlowFrame locale={locale} mainId="fan-verification-intro-main">
      <main className={styles.page} id="fan-verification-intro-main" tabIndex={-1}>
      <div className={styles.shell}>
        {screen.kind === "loading" && (
          <div className={styles.loading} role="status" aria-label={t.loadingAria}>
            <span /><span /><span /><p>{t.loading}</p>
          </div>
        )}
        {screen.kind === "error" && (
          <section className={styles.message} role="alert">
            <h1>{t.errorTitle}</h1><p>{screen.message}</p>
            <button className={styles.secondaryAction} type="button" onClick={() => void loadIntro()}><RotateCcw aria-hidden="true" /> {t.retry}</button>
          </section>
        )}
        {screen.kind === "ready" && screen.intro.quiz.availability === "unavailable" && (
          <section className={styles.message}>
            <h1>{t.unavailableTitle}</h1>
            <p>{t.unavailableBody(screen.intro.celebrity.name)}</p>
            <Link className={styles.secondaryAction} href={withLocale(`/c/${slug}`, locale)}>{t.fanPage()}</Link>
          </section>
        )}
        {screen.kind === "ready" && screen.intro.quiz.availability === "available" && (
          <section className={styles.entry} aria-labelledby="quiz-entry-heading">
            <Link className={styles.returnLink} href={withLocale(`/c/${slug}`, locale)}><ArrowLeft aria-hidden="true" />{t.fanPage(screen.intro.celebrity.name)}</Link>
            <header>
              <p>{t.eyebrow}</p>
              <h1
                id="quiz-entry-heading"
                aria-label={t.title(screen.intro.celebrity.name).replace("\n", " ")}
              >
                {t.title(screen.intro.celebrity.name).split("\n").map((line, index) => (
                  <span key={line}>{index > 0 ? <br /> : null}{line}</span>
                ))}
              </h1>
            </header>
            <p className={styles.description}>{t.description}</p>
            <ul className={styles.facts}>
              <li><Check aria-hidden="true" /><span><strong>{t.questionCount(screen.intro.quiz.totalQuestions)}</strong>{t.questionCountTail}</span></li>
              <li><Check aria-hidden="true" /><span><strong>{t.passThreshold(screen.intro.quiz.passThreshold)}</strong>{t.passThresholdTail}</span></li>
              <li><Check aria-hidden="true" /><span>{t.saved}</span></li>
            </ul>
            {!ready ? (
              <p className={styles.actionStatus} role="status">{t.authChecking}</p>
            ) : authenticated && profileState === "checking" ? (
              <p className={styles.actionStatus} role="status">{t.profileChecking}</p>
            ) : authenticated && profileState === "error" ? (
              <p className={styles.actionStatus} role="alert">{t.profileError}</p>
            ) : authenticated ? (
              <FanAction className={styles.entryAction} variant="primary" disabled={starting} ariaBusy={starting} onClick={() => void start()} trailingIcon={<ArrowRight />}>
                {starting ? t.starting : t.start}
              </FanAction>
            ) : (
              <AuthIntentLink className={fanActionClassName("primary", { className: styles.entryAction })} emphasis="primary" locale={locale} input={{ sourcePath: `/c/${slug}/verify`, sourceQuery: `?locale=${locale}`, actionType: "START_FAN_VERIFICATION", targetType: "celebrity", targetId: slug }}>{t.login}</AuthIntentLink>
            )}
            {startError && <p className={styles.inlineError} role="alert" tabIndex={-1}>{startError}</p>}
            <p className={styles.note}>{t.note}</p>
          </section>
        )}
      </div>
      </main>
    </FocusFlowFrame>
  );
}
