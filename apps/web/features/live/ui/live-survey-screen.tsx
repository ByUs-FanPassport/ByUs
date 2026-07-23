"use client";

import { usePrivy } from "@privy-io/react-auth";
import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Check, RotateCcw, Save, Stamp } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  liveSurveyResponseSchema,
  saveLiveSurveyDraftResponseSchema,
  submitLiveSurveyResponseSchema,
  type LiveSurveyResponse,
  type SurveyAnswer,
} from "@/features/live/domain/live-survey";
import { consumeAuthIntent, readAuthIntent } from "@/components/auth-intent";
import { AuthIntentLink } from "@/components/auth-intent-link";
import { FocusFlowHeader } from "@/components/fan-shell/focus-flow-header";
import styles from "./live-survey-screen.module.css";

type Locale = "ko" | "en";
type LoadState =
  | { kind: "loading" }
  | { kind: "error"; code: string }
  | { kind: "ready"; data: LiveSurveyResponse };
type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type Conflict = { server: LiveSurveyResponse; localAnswers: SurveyAnswer[] };

const copy = {
  ko: {
    back: "LIVE로 돌아가기",
    title: "LIVE 설문",
    subtitle: "함께한 LIVE에 대한 이야기를 들려주세요.",
    required: "필수",
    optional: "선택",
    attendanceTitle: "출석 확인 후 참여할 수 있어요",
    attendanceBody: "LIVE의 Fan Code로 출석을 완료하면 설문이 열립니다.",
    attendanceAction: "Fan Code 입력하러 가기",
    loading: "설문 불러오는 중",
    loadError: "설문을 불러오지 못했어요.",
    notFound: "현재 참여할 수 있는 설문이 없어요.",
    retry: "다시 불러오기",
    signIn: "로그인하고 설문 이어가기",
    saving: "초안 저장 중",
    saved: "초안 저장됨",
    saveError: "초안을 저장하지 못했어요. 답변은 이 화면에 남아 있습니다.",
    answerRequired: "이 질문에 답해 주세요.",
    textPlaceholder: "답변을 입력해 주세요.",
    textCount: (count: number) => `${count} / 4,000자`,
    submit: "설문 제출하기",
    submitting: "제출 중",
    submitError: "설문을 제출하지 못했어요. 답변을 확인하고 다시 시도해 주세요.",
    conflictTitle: "다른 화면에서 저장된 초안이 있어요",
    conflictBody: "어느 답변으로 계속할지 선택해 주세요. 선택하기 전에는 덮어쓰지 않습니다.",
    keepMine: "내 답변 유지",
    useSaved: "저장된 초안 사용",
    completeTitle: "설문 참여가 완료되었습니다",
    completeBody: "소중한 답변이 전달되었어요. LIVE 참여 기록도 함께 남겼습니다.",
    score: "Fan Score +2",
    stamp: "Survey Stamp 적립 완료",
    returnLive: "LIVE로 돌아가기",
    submittedAt: "제출 완료",
    singleHint: "한 가지를 선택해 주세요.",
    multipleHint: "해당하는 답변을 모두 선택해 주세요.",
    ratingHint: "1점부터 5점까지 선택해 주세요.",
  },
  en: {
    back: "Back to LIVE",
    title: "LIVE survey",
    subtitle: "Tell us about the LIVE you shared with us.",
    required: "Required",
    optional: "Optional",
    attendanceTitle: "Complete attendance to join",
    attendanceBody: "Verify attendance with the LIVE Fan Code to unlock this survey.",
    attendanceAction: "Enter Fan Code",
    loading: "Loading survey",
    loadError: "We couldn’t load this survey.",
    notFound: "There is no survey available right now.",
    retry: "Try again",
    signIn: "Sign in to continue",
    saving: "Saving draft",
    saved: "Draft saved",
    saveError: "We couldn’t save the draft. Your answers remain on this screen.",
    answerRequired: "Please answer this question.",
    textPlaceholder: "Write your answer.",
    textCount: (count: number) => `${count} / 4,000 characters`,
    submit: "Submit survey",
    submitting: "Submitting",
    submitError: "We couldn’t submit the survey. Review your answers and try again.",
    conflictTitle: "A newer draft was saved elsewhere",
    conflictBody: "Choose which answers to continue with. Nothing will be overwritten before you choose.",
    keepMine: "Keep my answers",
    useSaved: "Use saved draft",
    completeTitle: "Survey complete",
    completeBody: "Your response was delivered and added to your LIVE participation record.",
    score: "Fan Score +2",
    stamp: "Survey Stamp earned",
    returnLive: "Back to LIVE",
    submittedAt: "Submitted",
    singleHint: "Choose one answer.",
    multipleHint: "Choose all that apply.",
    ratingHint: "Choose a rating from 1 to 5.",
  },
} as const;

function answerMap(answers: SurveyAnswer[]): Map<string, SurveyAnswer> {
  return new Map(answers.map((answer) => [answer.questionId, answer]));
}

function stableAnswers(answers: SurveyAnswer[]): string {
  return JSON.stringify(
    answers
      .map((answer) => answer.selectedOptionIds
        ? { ...answer, selectedOptionIds: [...answer.selectedOptionIds].sort() }
        : answer)
      .sort((a, b) => a.questionId.localeCompare(b.questionId)),
  );
}

function requestKey(storageKey: string): string {
  const current = window.sessionStorage.getItem(storageKey);
  if (current) return current;
  const created = window.crypto.randomUUID();
  window.sessionStorage.setItem(storageKey, created);
  return created;
}

function errorCode(value: unknown): string {
  if (!value || typeof value !== "object" || !("error" in value)) return "SURVEY_UNAVAILABLE";
  const error = value.error;
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : "SURVEY_UNAVAILABLE";
}

function Header({ slug, locale }: { slug: string; locale: Locale }) {
  const other = locale === "ko" ? "en" : "ko";
  return (
    <FocusFlowHeader className={styles.header} innerClassName={styles.headerInner} sticky>
        <Link
          className={styles.locale}
          href={`/live/${slug}/survey?locale=${other}` as Route}
          lang={other}
          hrefLang={other}
        >
          {locale === "ko" ? "KO / EN" : "EN / KO"}
        </Link>
    </FocusFlowHeader>
  );
}

export function LiveSurveyScreen({ slug, locale }: { slug: string; locale: Locale }) {
  const c = copy[locale];
  const { ready: authReady, authenticated, getAccessToken } = usePrivy();
  const [view, setView] = useState<LoadState>({ kind: "loading" });
  const [answers, setAnswers] = useState<SurveyAnswer[]>([]);
  const [revision, setRevision] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitPending, setSubmitPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const initialized = useRef(false);
  const lastSaved = useRef("[]");
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const answerLookup = useMemo(() => answerMap(answers), [answers]);

  const load = useCallback(async (preserveLocal = false): Promise<LiveSurveyResponse | null> => {
    if (!authReady) return null;
    setView({ kind: "loading" });
    try {
      const token = authenticated ? await getAccessToken() : null;
      if (!token) {
        setView({ kind: "error", code: "AUTHENTICATION_REQUIRED" });
        return null;
      }
      const response = await fetch(`/api/live-events/${encodeURIComponent(slug)}/survey?locale=${locale}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setView({ kind: "error", code: errorCode(json) });
        return null;
      }
      const data = liveSurveyResponseSchema.parse(json);
      setView({ kind: "ready", data });
      if (!preserveLocal) {
        const loadedAnswers = data.response?.answers ?? [];
        setAnswers(loadedAnswers);
        setRevision(data.response?.revision ?? 0);
        lastSaved.current = stableAnswers(loadedAnswers);
        setSaveState(data.response?.status === "draft" ? "saved" : "idle");
      }
      initialized.current = true;
      return data;
    } catch {
      setView({ kind: "error", code: "SURVEY_UNAVAILABLE" });
      return null;
    }
  }, [authReady, authenticated, getAccessToken, locale, slug]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!authenticated || view.kind !== "ready") return;
    const intentId = new URLSearchParams(window.location.search).get("authIntent");
    const intent = readAuthIntent(window.sessionStorage, intentId);
    if (intent?.actionType === "OPEN_SURVEY" && intent.targetType === "survey" && intent.targetId === slug) {
      consumeAuthIntent(window.sessionStorage, intent.id);
    }
  }, [authenticated, slug, view]);

  const saveDraft = useCallback(async (draftAnswers: SurveyAnswer[], expectedRevision: number, resolveConflict = false) => {
    if ((!resolveConflict && conflict) || submitPending) return;
    setSaveState("saving");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing token");
      const response = await fetch(`/api/live-events/${encodeURIComponent(slug)}/survey`, {
        method: "PUT",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: window.crypto.randomUUID(),
          expectedRevision,
          answers: draftAnswers,
        }),
      });
      const json: unknown = await response.json().catch(() => null);
      if (response.status === 409 && errorCode(json) === "REVISION_CONFLICT") {
        const server = await load(true);
        if (server) setConflict({ server, localAnswers: draftAnswers });
        setSaveState("dirty");
        return;
      }
      if (!response.ok) throw new Error("draft failed");
      const saved = saveLiveSurveyDraftResponseSchema.parse(json);
      setRevision(saved.response.revision);
      lastSaved.current = stableAnswers(saved.response.answers);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [conflict, getAccessToken, load, slug, submitPending]);

  useEffect(() => {
    if (!initialized.current || view.kind !== "ready" || view.data.response?.status === "submitted" || conflict || saveState === "saving") return;
    const serialized = stableAnswers(answers);
    if (serialized === lastSaved.current) return;
    setSaveState("dirty");
    const timeout = window.setTimeout(() => void saveDraft(answers, revision), 700);
    return () => window.clearTimeout(timeout);
  }, [answers, conflict, revision, saveDraft, saveState, view]);

  function replaceAnswer(answer: SurveyAnswer) {
    // A submission key is valid only for the exact answer set it first carried.
    // Keep answer content in React memory; session storage contains only UUIDs.
    window.sessionStorage.removeItem(`byus:survey-submit-key:${slug}`);
    const empty = (answer.selectedOptionIds !== undefined && answer.selectedOptionIds.length === 0)
      || (answer.freeText !== undefined && answer.freeText.length === 0);
    setAnswers((current) => {
      const remaining = current.filter((item) => item.questionId !== answer.questionId);
      return empty ? remaining : [...remaining, answer];
    });
    setErrors((current) => {
      const next = { ...current };
      delete next[answer.questionId];
      return next;
    });
    setSubmitError(null);
  }

  function validate(): boolean {
    if (view.kind !== "ready") return false;
    const next: Record<string, string> = {};
    for (const question of view.data.survey.questions) {
      if (!question.required) continue;
      const answer = answerLookup.get(question.id);
      const missing = !answer
        || (answer.selectedOptionIds !== undefined && answer.selectedOptionIds.length === 0)
        || (answer.freeText !== undefined && answer.freeText.trim().length === 0);
      if (missing) next[question.id] = c.answerRequired;
    }
    setErrors(next);
    if (Object.keys(next).length > 0) {
      window.requestAnimationFrame(() => {
        const first = document.querySelector<HTMLElement>(`[data-question-id="${Object.keys(next)[0]}"] input, [data-question-id="${Object.keys(next)[0]}"] textarea`);
        first?.focus();
        if (typeof errorSummaryRef.current?.scrollIntoView === "function") {
          errorSummaryRef.current.scrollIntoView({ block: "nearest" });
        }
      });
      return false;
    }
    return true;
  }

  async function submit() {
    if (submitPending || conflict || view.kind !== "ready" || !validate()) return;
    const submissionAnswers = answers.filter((answer) => answer.freeText === undefined || answer.freeText.trim().length > 0);
    setSubmitPending(true);
    setSubmitError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing token");
      const keyStorage = `byus:survey-submit-key:${slug}`;
      const response = await fetch(`/api/live-events/${encodeURIComponent(slug)}/survey`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: requestKey(keyStorage), answers: submissionAnswers }),
      });
      const json: unknown = await response.json().catch(() => null);
      if (response.status === 409 && errorCode(json) === "SURVEY_ALREADY_SUBMITTED") {
        const current = await load();
        if (current?.response?.status === "submitted") {
          window.sessionStorage.removeItem(keyStorage);
          return;
        }
      }
      if (!response.ok) throw new Error(errorCode(json));
      submitLiveSurveyResponseSchema.parse(json);
      window.sessionStorage.removeItem(keyStorage);
      const refreshed = await load();
      if (!refreshed?.response || refreshed.response.status !== "submitted") throw new Error("submission not projected");
    } catch {
      setSubmitError(c.submitError);
    } finally {
      setSubmitPending(false);
    }
  }

  async function keepLocalAnswers() {
    if (!conflict) return;
    const serverRevision = conflict.server.response?.revision ?? 0;
    const local = conflict.localAnswers;
    setConflict(null);
    setAnswers(local);
    setRevision(serverRevision);
    lastSaved.current = stableAnswers(conflict.server.response?.answers ?? []);
    await saveDraft(local, serverRevision, true);
  }

  function useServerAnswers() {
    if (!conflict) return;
    const serverAnswers = conflict.server.response?.answers ?? [];
    setAnswers(serverAnswers);
    setRevision(conflict.server.response?.revision ?? 0);
    lastSaved.current = stableAnswers(serverAnswers);
    setView({ kind: "ready", data: conflict.server });
    setConflict(null);
    setSaveState("saved");
  }

  const liveHref = `/live/${slug}?locale=${locale}` as Route;

  if (view.kind === "loading" && !conflict) {
    return <div className={styles.page}><Header slug={slug} locale={locale} /><main className={styles.loading} aria-busy="true" aria-label={c.loading}><div /><div /><div /></main></div>;
  }

  if (view.kind === "error") {
    const notFound = view.code === "SURVEY_NOT_FOUND";
    const authenticationRequired = view.code === "AUTHENTICATION_REQUIRED";
    return (
      <div className={styles.page}>
        <Header slug={slug} locale={locale} />
        <main className={styles.state} role="alert">
          <RotateCcw aria-hidden="true" />
          <h1>{notFound ? c.notFound : authenticationRequired ? c.signIn : c.loadError}</h1>
          {authenticationRequired ? (
            <AuthIntentLink
              className={styles.primary}
              locale={locale}
              input={{ sourcePath: `/live/${slug}/survey`, sourceQuery: `?locale=${locale}`, actionType: "OPEN_SURVEY", targetType: "survey", targetId: slug }}
            >{c.signIn}</AuthIntentLink>
          ) : !notFound && <button type="button" onClick={() => void load()}>{c.retry}</button>}
          <Link href={liveHref}>{c.back}</Link>
        </main>
      </div>
    );
  }

  if (view.kind !== "ready") return null;
  const data = view.data;

  if (!data.eligibility.completedAttendance) {
    return (
      <div className={styles.page}>
        <Header slug={slug} locale={locale} />
        <main className={styles.state}>
          <div className={styles.stateIcon}><Stamp aria-hidden="true" /></div>
          <h1>{c.attendanceTitle}</h1>
          <p>{c.attendanceBody}</p>
          <Link className={styles.primary} href={`${liveHref}#fan-code` as Route}>{c.attendanceAction}</Link>
        </main>
      </div>
    );
  }

  if (data.response?.status === "submitted") {
    return (
      <div className={styles.page}>
        <Header slug={slug} locale={locale} />
        <main className={styles.complete}>
          <div className={styles.completeMark}><Check aria-hidden="true" /></div>
          <h1>{c.completeTitle}</h1>
          <p>{c.completeBody}</p>
          <Image className={styles.stampArtwork} src="/images/stamps/kara-survey-stamp.png" alt={locale === "ko" ? "KARA Survey Stamp" : "KARA Survey Stamp"} width={360} height={360} priority />
          <div className={styles.rewards}>
            <strong>{c.score}</strong>
            <span><Stamp aria-hidden="true" />{c.stamp}</span>
          </div>
          {data.response.submittedAt && <time dateTime={data.response.submittedAt}>{c.submittedAt} · {new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.response.submittedAt))}</time>}
          <Link className={styles.primary} href={liveHref}>{c.returnLive}</Link>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Header slug={slug} locale={locale} />
      <main className={styles.main}>
        <Link className={styles.back} href={liveHref}><ArrowLeft aria-hidden="true" />{c.back}</Link>
        <header className={styles.intro}>
          <div>
            <h1>{c.title}</h1>
            <p>{c.subtitle}</p>
          </div>
          <p className={styles.saveStatus} role="status" aria-live="polite" data-state={saveState}>
            {saveState === "saving" ? <><Save aria-hidden="true" />{c.saving}</> : saveState === "saved" ? <><Check aria-hidden="true" />{c.saved}</> : saveState === "error" ? c.saveError : null}
          </p>
        </header>

        {conflict && (
          <section className={styles.conflict} aria-labelledby="conflict-title" aria-live="assertive">
            <div><h2 id="conflict-title">{c.conflictTitle}</h2><p>{c.conflictBody}</p></div>
            <div className={styles.conflictActions}>
              <button type="button" onClick={() => void keepLocalAnswers()}>{c.keepMine}</button>
              <button type="button" onClick={useServerAnswers}>{c.useSaved}</button>
            </div>
          </section>
        )}

        {Object.keys(errors).length > 0 && <div ref={errorSummaryRef} className={styles.errorSummary} role="alert">{c.answerRequired}</div>}

        <form onSubmit={(event) => { event.preventDefault(); void submit(); }} noValidate>
          <ol className={styles.questions}>
            {data.survey.questions.map((question, index) => {
              const answer = answerLookup.get(question.id);
              const error = errors[question.id];
              const descriptionId = `${question.id}-description`;
              const errorId = `${question.id}-error`;
              return (
                <li key={question.id} className={styles.question} data-question-id={question.id}>
                  <fieldset aria-describedby={`${descriptionId}${error ? ` ${errorId}` : ""}`}>
                    <legend><span className={styles.number}>{index + 1}</span><span className={styles.questionText}>{question.question}</span><small>{question.required ? c.required : c.optional}</small></legend>
                    <p id={descriptionId} className={styles.hint}>
                      {question.type === "single_choice" ? c.singleHint : question.type === "multiple_choice" ? c.multipleHint : question.type === "rating_1_5" ? c.ratingHint : c.textCount(answer?.freeText?.length ?? 0)}
                    </p>
                    {question.type === "single_choice" && <div className={styles.options}>{question.options.map((option) => <label key={option.id}><input type="radio" name={question.id} value={option.id} checked={answer?.selectedOptionIds?.[0] === option.id} required={question.required} onChange={() => replaceAnswer({ questionId: question.id, selectedOptionIds: [option.id] })} /><span>{option.label}</span></label>)}</div>}
                    {question.type === "multiple_choice" && <div className={styles.options}>{question.options.map((option) => {
                      const selected = answer?.selectedOptionIds ?? [];
                      return <label key={option.id}><input type="checkbox" name={question.id} value={option.id} checked={selected.includes(option.id)} aria-invalid={Boolean(error)} onChange={(event) => replaceAnswer({ questionId: question.id, selectedOptionIds: event.target.checked ? [...selected, option.id] : selected.filter((id) => id !== option.id) })} /><span>{option.label}</span></label>;
                    })}</div>}
                    {question.type === "rating_1_5" && <div className={styles.rating}>{[1, 2, 3, 4, 5].map((value) => <label key={value}><input type="radio" name={question.id} value={value} checked={answer?.rating === value} required={question.required} onChange={() => replaceAnswer({ questionId: question.id, rating: value })} /><span>{value}</span></label>)}</div>}
                    {question.type === "free_text" && <textarea aria-label={question.question} value={answer?.freeText ?? ""} maxLength={4000} required={question.required} aria-invalid={Boolean(error)} aria-describedby={`${descriptionId}${error ? ` ${errorId}` : ""}`} placeholder={c.textPlaceholder} onChange={(event) => replaceAnswer({ questionId: question.id, freeText: event.target.value })} />}
                    {error && <p className={styles.fieldError} id={errorId}>{error}</p>}
                  </fieldset>
                </li>
              );
            })}
          </ol>
          {submitError && <p className={styles.submitError} role="alert">{submitError}</p>}
          <button className={styles.submit} type="submit" disabled={submitPending || Boolean(conflict)} aria-busy={submitPending}>{submitPending ? c.submitting : c.submit}</button>
        </form>
      </main>
    </div>
  );
}
