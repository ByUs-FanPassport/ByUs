"use client";
import { participationCopy } from "@/i18n/catalogs/features__schedules__ui__participation";
import { FanLanguageSwitch } from "@/components/fan-shell/fan-language-switch";
import { toContentLocale } from "@/i18n/locales";
import type { AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/features__live__ui__live-mission-screen";
import { translate } from "@/i18n/messages";
import Link from "next/link";
import Image from "next/image";
import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { liveEventResponseSchema } from "../domain/live-event";
import { liveMissionCompletionSchema, liveMissionListSchema, liveMissionSchema } from "../domain/live-mission";
import { FanState } from "../../../components/fan-ui/fan-state";
import { FanAction } from "../../../components/fan-ui/fan-action";
import { FocusFlowHeader } from "../../../components/fan-shell/focus-flow-header";
import { elinaLiveSlug } from "../domain/elina-event";
import { ArtMissionHeader, ArtMissionPlay, supportsArtMissionPlay } from "./art-mission-play";
import styles from "./live-mission-screen.module.css";

type Mission = z.infer<typeof liveMissionSchema>;
type Props = { slug: string; locale: AppLocale };
type SubmissionState = "pending" | "complete" | "error";

export function LiveMissionScreen(props: Props) {
  const auth = usePrivy();
  const artCampaign = props.slug === elinaLiveSlug;
  return <div className={`${styles.surface} ${artCampaign ? styles.artSurface : ""}`} data-fan-surface lang={props.locale}>
    {artCampaign ? <ArtMissionHeader locale={props.locale} /> : <FocusFlowHeader locale={props.locale} mainId="live-mission-main" innerClassName={styles.headerInner} sticky>
      <FanLanguageSwitch locale={props.locale} href={`/live/${props.slug}/missions?locale=${props.locale}`} />
    </FocusFlowHeader>}
    <MissionContent key={`${auth.ready}:${auth.authenticated}:${auth.user?.id ?? "guest"}:${props.slug}:${props.locale}`} {...props} auth={auth} />
  </div>;
}

function MissionContent({ slug, locale, auth }: Props & { auth: ReturnType<typeof usePrivy> }) {
  const { ready, authenticated, login, getAccessToken } = auth;
  const c = participationCopy(locale);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const [title, setTitle] = useState("");
  const [missions, setMissions] = useState<Mission[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submissions, setSubmissions] = useState<Record<string, SubmissionState>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const active = useRef(true);
  const inFlight = useRef(new Map<string, AbortController>());
  const requestKeys = useRef(new Map<string, { fingerprint: string; key: string }>());

  useEffect(() => {
    active.current = true;
    const requests = inFlight.current;
    return () => { active.current = false; requests.forEach(controller => controller.abort()); requests.clear(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/live-events/${encodeURIComponent(slug)}?locale=${toContentLocale(locale)}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (response.ok) {
          const body = liveEventResponseSchema.parse(await response.json());
          if (!controller.signal.aborted) setTitle(body.live.title);
        }
      }).catch(() => {});
    return () => controller.abort();
  }, [slug, locale]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    const controller = new AbortController();
    setLoadState("loading");
    void (async () => {
      const token = await getAccessToken();
      if (controller.signal.aborted) return;
      if (!token) throw new Error("Missing token");
      const response = await fetch(`/api/live-events/${encodeURIComponent(slug)}/missions?locale=${toContentLocale(locale)}`, {
        signal: controller.signal, headers: { authorization: `Bearer ${token}` }, cache: "no-store",
      });
      if (!response.ok) throw new Error("Mission request failed");
      const data = liveMissionListSchema.parse(await response.json());
      if (!controller.signal.aborted) { setMissions(data); setLoadState("ready"); }
    })().catch(() => { if (!controller.signal.aborted) setLoadState("error"); });
    return () => controller.abort();
  }, [ready, authenticated, getAccessToken, locale, slug, retry]);

  async function submit(mission: Mission) {
    if (inFlight.current.has(mission.id) || mission.completed || (mission.eligibility && mission.eligibility !== "available") || mission.questions.some(question => !answers[question.id])) return;
    const controller = new AbortController();
    inFlight.current.set(mission.id, controller);
    setSubmissions(current => ({ ...current, [mission.id]: "pending" }));
    const selectedAnswers = mission.questions.map(question => ({ questionId: question.id, selectedOptionIds: [answers[question.id]] }));
    const fingerprint = JSON.stringify({ version: mission.version, answers: selectedAnswers });
    let request = requestKeys.current.get(mission.id);
    if (request?.fingerprint !== fingerprint) {
      request = { fingerprint, key: crypto.randomUUID() };
      requestKeys.current.set(mission.id, request);
    }
    try {
      const token = await getAccessToken();
      if (!active.current || controller.signal.aborted) return;
      if (!token) throw new Error("Missing token");
      const response = await fetch(`/api/missions/${mission.id}/submit`, {
        method: "POST", signal: controller.signal,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: request.key, answers: selectedAnswers }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { code?: unknown } } | null;
        const code = body?.error?.code;
        throw new Error(typeof code === "string" && /^MISSION_[A-Z_]+$/.test(code) ? code : "MISSION_UNAVAILABLE");
      }
      const completed = liveMissionCompletionSchema.parse(await response.json()).mission;
      if (completed.id !== mission.id || completed.type !== mission.type) throw new Error("Mission response mismatch");
      if (!active.current || controller.signal.aborted) return;
      setMissions(current => current.map(item => item.id === completed.id ? { ...item, completed: true, eligibility: "completed" as const, completedAt: new Date().toISOString() } : item));
      setSubmissions(current => ({ ...current, [mission.id]: "complete" }));
      requestKeys.current.delete(mission.id);
      return completed;
    } catch (error) {
      if (active.current && !controller.signal.aborted) {
        setErrors(current => ({ ...current, [mission.id]: error instanceof Error ? error.message : "MISSION_UNAVAILABLE" }));
        setSubmissions(current => ({ ...current, [mission.id]: "error" }));
      }
    } finally {
      inFlight.current.delete(mission.id);
    }
  }

  const back = <Link className={styles.back} href={`/live/${slug}?locale=${locale}`}>{locale === "ko" ? "LIVE로 돌아가기" : translate(locale, localizedMessages.m0fd55b295f20, "Back to LIVE")}</Link>;
  if (!ready) return <main className={styles.page} id="live-mission-main" tabIndex={-1}>{back}<FanState kind="loading" title={locale === "ko" ? "참여 정보를 확인하고 있어요." : translate(locale, localizedMessages.m25d053f465c8, "Checking participation.")} /></main>;
  if (!authenticated) return <main className={styles.page} id="live-mission-main" tabIndex={-1}>{back}<h1>{locale === "ko" ? "LIVE 미션" : translate(locale, localizedMessages.m9e1272e7e694, "LIVE Missions")}</h1><button onClick={login}>{locale === "ko" ? "로그인하고 참여하기" : translate(locale, localizedMessages.mb3747fde918f, "Sign in to join")}</button></main>;
  if (loadState === "ready" && slug === elinaLiveSlug && supportsArtMissionPlay(missions) && missions.every(mission => !mission.eligibility || ["available", "completed"].includes(mission.eligibility))) {
    return <ArtMissionPlay missions={missions} locale={locale} answers={answers} submissions={submissions} errors={errors}
      onAnswer={(questionId, optionId) => setAnswers(current => ({ ...current, [questionId]: optionId }))} onSubmit={submit} />;
  }
  return <main className={styles.page} id="live-mission-main" tabIndex={-1}>
    {back}<header><p>{title || (locale === "ko" ? "LIVE 참여 미션" : translate(locale, localizedMessages.maef244b8cb1d, "LIVE participation"))}</p><h1>{locale === "ko" ? "미션" : translate(locale, localizedMessages.m33fa9338bae8, "Missions")}</h1></header>
    {loadState === "loading" ? <FanState kind="loading" title={locale === "ko" ? "미션을 불러오고 있어요." : translate(locale, localizedMessages.mcabe043759ae, "Loading missions.")} />
      : loadState === "error" ? <FanState kind="error" title={locale === "ko" ? "미션을 불러오지 못했어요." : translate(locale, localizedMessages.mddfe2c1fc9f7, "Could not load missions.")} actions={<FanAction onClick={() => setRetry(value => value + 1)}>{locale === "ko" ? "다시 시도" : translate(locale, localizedMessages.m323140c34cfd, "Try again")}</FanAction>} />
      : missions.length === 0 ? <p>{locale === "ko" ? "지금 참여할 수 있는 미션이 없어요." : translate(locale, localizedMessages.m5a132c3337b9, "No missions are available right now.")}</p>
      : missions.map(mission => {
        const pending = submissions[mission.id] === "pending";
        const blocked = Boolean(mission.eligibility && !["available", "completed"].includes(mission.eligibility));
        const editing = !mission.completed && mission.questions.some(question => Boolean(answers[question.id]));
        const label = mission.completed ? c.completed : mission.eligibility === "passport_required" ? c.verify : mission.eligibility === "attendance_required" ? c.checkin : mission.eligibility === "wallet_pending" ? c.wallet : blocked ? c.closed : editing ? c.editing : c.available;
        const href = mission.nextAction?.href ? new URL(mission.nextAction.href, "https://byus.invalid") : null;
        if (href) href.searchParams.set("locale", locale);
        return <article key={mission.id} className={styles.card} aria-busy={pending}>
          <span>{mission.type.toUpperCase()} · {label}</span><h2>{mission.title}</h2><p>{mission.description}</p>
          {mission.completedAt && <p><time dateTime={mission.completedAt}>{new Date(mission.completedAt).toLocaleString(locale)}</time></p>}
          {href && <FanAction href={`${href.pathname}${href.search}${href.hash}`}>{mission.completed ? c.view : label}</FanAction>}
          {!blocked && mission.questions.map(question => <fieldset key={question.id} disabled={pending || mission.completed || blocked}>
            <legend>{question.text}</legend>{question.media && <Media value={question.media} alt={question.text} />}
            {question.options.map(option => <label key={option.id} className={styles.option}>
              <input aria-label={option.label} type="radio" name={question.id} checked={answers[question.id] === option.id} onChange={() => setAnswers(current => ({ ...current, [question.id]: option.id }))} />
              {option.media && <Media value={option.media} alt="" />}{option.displayMode !== "media" && <span>{option.label}</span>}
            </label>)}
          </fieldset>)}
          <button disabled={pending || mission.completed || blocked || mission.questions.some(question => !answers[question.id])} onClick={() => void submit(mission)}>
            {pending ? (locale === "ko" ? "제출 중…" : translate(locale, localizedMessages.m4ea9a49f362b, "Submitting…")) : mission.completed ? (locale === "ko" ? "완료됨" : translate(locale, localizedMessages.m4c70b81bb0c3, "Completed")) : (locale === "ko" ? "미션 완료" : translate(locale, localizedMessages.me1b43e38ddba, "Complete mission"))}
          </button>
          {submissions[mission.id] === "complete" && <p role="status" className={styles.notice}>{locale === "ko" ? "미션을 완료했어요. 보상과 Stamp가 기록되었습니다." : translate(locale, localizedMessages.m69b94777d35b, "Mission complete. Your rewards and Stamp were recorded.")}</p>}
          {submissions[mission.id] === "error" && <p role="alert" className={styles.notice}>{locale === "ko" ? "미션을 완료하지 못했어요. 다시 시도해 주세요." : translate(locale, localizedMessages.m7e12c8224787, "Mission could not be completed. Please try again.")}</p>}
        </article>;
      })}
  </main>;
}
function Media({ value, alt }: { value: { type: "image" | "video"; url: string }; alt: string }) {
  return value.type === "video" ? <video aria-label={alt || undefined} controls preload="metadata" src={value.url} /> : <Image unoptimized src={value.url} alt={alt} width={640} height={360} />;
}
