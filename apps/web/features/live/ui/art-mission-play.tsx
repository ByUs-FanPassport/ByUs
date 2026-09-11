"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowRight, Check, Circle, CircleCheck } from "lucide-react";
import type { z } from "zod";
import type { liveMissionCompletionSchema, liveMissionSchema } from "../domain/live-mission";
import { elinaLiveSlug } from "../domain/elina-event";
import styles from "./art-mission-play.module.css";

type Mission = z.infer<typeof liveMissionSchema>;
type Completion = z.infer<typeof liveMissionCompletionSchema>["mission"];
type Locale = "ko" | "en";
type Props = {
  missions: Mission[];
  locale: Locale;
  answers: Record<string, string>;
  submissions: Record<string, "pending" | "complete" | "error">;
  errors: Record<string, string>;
  onAnswer: (questionId: string, optionId: string) => void;
  onSubmit: (mission: Mission) => Promise<Completion | undefined>;
};

// This presentation requires an image vote and an image quiz. Other mission
// configurations retain the general renderer, including multi-question surveys.
export function supportsArtMissionPlay(missions: Mission[]) {
  if (missions.length !== 2) return false;
  const vote = missions.find(mission => mission.type === "vote");
  const quiz = missions.find(mission => mission.type === "quiz");
  return Boolean(vote && quiz && vote.questions.length === 1 && quiz.questions.length === 1
    && vote.questions[0].media === null
    && vote.questions[0].options.length === 3
    && vote.questions[0].options.every(option => option.media?.type === "image" && option.displayMode === "text_media")
    && quiz.questions[0].media?.type === "image"
    && quiz.questions[0].options.length === 4
    && quiz.questions[0].options.every(option => option.displayMode === "text"));
}

export function ArtMissionHeader({ locale }: { locale: Locale }) {
  const ko = locale === "ko";
  const other = ko ? "en" : "ko";
  return <>
    <a className={styles.skipLink} href="#live-mission-main">{ko ? "본문으로 바로가기" : "Skip to content"}</a>
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link className={styles.back} href={`/live/${elinaLiveSlug}?locale=${locale}`} aria-label={ko ? "LIVE로 돌아가기" : "Back to LIVE"}><ArrowLeft aria-hidden="true" /></Link>
        <div className={styles.brand}><span>ELINA × BANKSY</span><strong>ART PLAY</strong></div>
        <Link className={styles.locale} href={`/live/${elinaLiveSlug}/missions?locale=${other}`} lang={other} hrefLang={other}>{ko ? "KO / EN" : "EN / KO"}</Link>
      </div>
    </header>
  </>;
}

function stageName(mission: Mission, ko: boolean) {
  return mission.type === "vote" ? (ko ? "취향 고르기" : "Your pick") : (ko ? "디테일 퀴즈" : "Detail quiz");
}

function questionHeading(mission: Mission, ko: boolean) {
  const question = mission.questions[0].text;
  // Compact the approved campaign questions without overriding later CMS edits.
  const headings: Record<string, string> = ko ? {
    "가장 눈길이 가는 뱅크시 작품은 무엇인가요?": "마음이 가는 작품을 PICK!",
    "그림 속 빨간 풍선은 어떤 모양인가요?": "빨간 풍선의 모양은?",
  } : {
    "Which Banksy artwork catches your eye the most?": "Pick the artwork you love",
    "What shape is the red balloon in the artwork?": "What shape is the red balloon?",
  };
  return headings[question] ?? question;
}

function artworkCredit(description: string, ko: boolean) {
  const marker = ko ? "작품 이미지:" : /Images? courtesy of/;
  const start = typeof marker === "string" ? description.indexOf(marker) : description.search(marker);
  return start >= 0 ? description.slice(start) : description;
}

// A finite, decorative burst only after a response accepted in this session.
// CSS owns playback, so there are no timers to outlive an account change.
function CompletionConfetti() {
  return <div className={styles.confetti} aria-hidden="true">{Array.from({ length: 28 }, (_, index) => {
    const side = index % 2 ? 1 : -1;
    return <i key={index} style={{
      "--burst-x": `${side * (10 + (index * 7) % 37)}vw`,
      "--burst-y": `${-24 + (index * 11) % 64}vh`,
      "--burst-turn": `${side * (140 + index * 29)}deg`,
      "--burst-delay": `${160 + (index % 5) * 40}ms`,
    } as CSSProperties} />;
  })}</div>;
}

function submissionMessage(code: string | undefined, ko: boolean) {
  if (code === "MISSION_PASSPORT_REQUIRED") return ko ? "팬 인증으로 패스포트를 만든 뒤 참여해 주세요." : "Create your Passport through fan verification to join.";
  if (code === "MISSION_ATTENDANCE_REQUIRED") return ko ? "LIVE 출석을 인증한 뒤 참여해 주세요." : "Check in to the LIVE before joining.";
  if (code === "MISSION_WALLET_NOT_READY") return ko ? "패스포트 참여 준비 중이에요. 잠시 후 다시 시도해 주세요." : "Your account is getting ready. Please try again shortly.";
  if (code === "MISSION_NOT_VISIBLE") return ko ? "이 미션의 참여 기간이 지났어요." : "This mission is no longer open.";
  if (code === "MISSION_ALREADY_COMPLETED") return ko ? "이미 완료한 미션이에요. 새로고침하면 참여 기록을 확인할 수 있어요." : "This mission is already complete. Refresh to see your participation record.";
  return ko ? "미션을 완료하지 못했어요. 선택한 답은 그대로예요. 다시 시도해 주세요." : "We couldn't complete the mission. Your answer is saved here. Please try again.";
}

export function ArtMissionPlay({ missions, locale, answers, submissions, errors, onAnswer, onSubmit }: Props) {
  const ko = locale === "ko";
  const ordered = [...missions].sort((a, b) => Number(a.type === "quiz") - Number(b.type === "quiz"));
  const [selectedId, setSelectedId] = useState<string | null>(() => ordered.find(mission => !mission.completed)?.id ?? null);
  const [result, setResult] = useState<Completion | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousId = useRef(selectedId);
  const current = ordered.find(mission => mission.id === selectedId && !mission.completed) ?? ordered.find(mission => !mission.completed);
  const busy = Object.values(submissions).some(state => state === "pending");
  const voteQuestion = ordered.find(mission => mission.type === "vote")?.questions[0];
  const pickedArtwork = voteQuestion?.options.find(option => option.id === answers[voteQuestion.id]);
  const completionArtwork = pickedArtwork?.media ?? ordered.find(mission => mission.type === "quiz")?.questions[0].media;

  useEffect(() => {
    if (previousId.current !== selectedId) {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: "start", behavior: "instant" });
      previousId.current = selectedId;
    }
  }, [selectedId]);

  async function confirm() {
    if (!current || busy) return;
    const completed = await onSubmit(current);
    if (!completed) return;
    setResult(completed);
    setSelectedId(ordered.find(mission => mission.id !== completed.id && !mission.completed)?.id ?? null);
  }

  if (!current) return <main className={styles.complete} data-celebrate={Boolean(result)} id="live-mission-main" tabIndex={-1}>
    {result && <CompletionConfetti />}
    <h1 ref={heading} tabIndex={-1}>{ko ? <>두 미션<br />모두 완료!</> : <>Both missions<br />complete!</>}</h1>
    <p role="status">{result?.correctness === true ? (ko ? "정답이에요! 스탬프를 남겼어요." : "That's right! Your Stamp is recorded.")
      : result?.correctness === false ? (ko ? "정답은 아니지만, 미션 참여는 완료됐어요." : "Not the right answer, but your mission is complete.")
      : result ? (ko ? "취향을 남겼어요! 스탬프도 기록됐어요." : "Your pick and Stamp are recorded.")
      : (ko ? "이미 참여한 미션이에요. 패스포트에서 기록을 확인해 보세요." : "You've already completed these missions. View your record in your Passports.")}</p>
    <div className={styles.collectibleScene} aria-hidden="true">
      <div className={styles.artworkPrint}>
        <span className={styles.printEdition}>ELINA × BANKSY <span>ART PLAY</span></span>
        {completionArtwork && <div className={styles.printImage}><Image unoptimized src={completionArtwork.url} alt="" width={320} height={430} /></div>}
        <div className={styles.printCaption}><span>{pickedArtwork ? (ko ? "내가 고른 작품" : "MY PICK") : "ART PLAY"}</span><strong>{pickedArtwork?.label ?? (ko ? "엘리나와 뱅크시" : "Elina × Banksy")}</strong></div>
      </div>
      <span className={styles.completionSeal}>{ko ? "참여 완료" : "COMPLETED"}</span>
    </div>
    {result && <section className={styles.rewardSection} aria-label={ko ? "이번 미션 보상" : "Rewards from this mission"}>
      <p>{result.type === "quiz" ? (ko ? "이번 퀴즈 참여로 기록됐어요" : "Recorded for this quiz") : (ko ? "이번 투표 참여로 기록됐어요" : "Recorded for this vote")}</p>
      <dl className={styles.rewards}>
        <div><dt>{ko ? "팬 점수" : "Fan score"}</dt><dd><span>+{result.scorePoints}</span></dd></div>
        <div><dt>{ko ? "응모권" : "Raffle tickets"}</dt><dd><span>+{result.ticketAmount}</span></dd></div>
      </dl>
    </section>}
    <ul className={styles.completedStages}>{ordered.map(mission => <li key={mission.id}><CircleCheck aria-hidden="true" />{stageName(mission, ko)}</li>)}</ul>
    <Link className={styles.primary} href={`/c/elina?locale=${locale}`}>{ko ? "엘리나 팬페이지로" : "Back to Elina"}<ArrowRight aria-hidden="true" /></Link>
    <Link className={styles.passportLink} href={`/passports?locale=${locale}`}>{ko ? "내 패스포트 보기" : "View my Passports"}<ArrowRight aria-hidden="true" /></Link>
  </main>;

  const question = current.questions[0];
  const vote = current.type === "vote";
  const selected = question.options.find(option => option.id === answers[question.id]);
  const preview = selected ?? question.options[0];
  const pending = submissions[current.id] === "pending";
  const error = submissions[current.id] === "error";
  const label = pending ? (ko ? "제출 중…" : "Submitting…") : vote ? (ko ? "이 작품으로 결정" : "Confirm my pick") : (ko ? "정답 확인하기" : "Check my answer");

  return <main className={styles.play} id="live-mission-main" tabIndex={-1}>
    <nav className={styles.progress} aria-label={ko ? "미션 진행" : "Mission progress"}>
      <ol>{ordered.map((mission, index) => <li key={mission.id}>
        <button type="button" aria-label={mission.completed ? `${stageName(mission, ko)} ${ko ? "완료" : "completed"}` : undefined} aria-current={mission.id === current.id ? "step" : undefined} disabled={busy || mission.completed} onClick={() => setSelectedId(mission.id)}>
          {mission.completed ? <Check aria-hidden="true" /> : <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>}
          {stageName(mission, ko)}
        </button>
      </li>)}</ol>
    </nav>
    <header key={`${current.id}-heading`} className={styles.questionHeading}>
      <h1 ref={heading} tabIndex={-1}>{questionHeading(current, ko)}</h1>
      {vote && <p>{ko ? "정답은 없어요. 마음이 가는 작품 하나." : "There is no right answer. Pick your favorite."}</p>}
    </header>
    <div key={current.id} className={`${styles.body} ${vote ? styles.voteBody : styles.quizBody}`} aria-busy={pending}>
      <section className={styles.question} aria-label={question.text}>
        {vote && preview.media && <div className={styles.artPreview} data-selected={Boolean(selected)} aria-hidden="true">
          <div className={styles.imageField}>{question.options.map(option => option.media && <Image key={option.id} className={styles.previewArtwork} data-active={option.id === preview.id} unoptimized src={option.media.url} alt="" width={640} height={860} priority />)}</div>
          <div className={styles.previewCaption}><strong>{preview.label}</strong>{selected && <CircleCheck />}</div>
        </div>}
        {!vote && question.media && <div className={styles.quizImage}><Image unoptimized src={question.media.url} alt={ko ? "퀴즈에 나온 작품" : "Artwork for this quiz"} width={640} height={860} priority /></div>}
        {!vote && <p className={styles.answerHint}>{ko ? "그림을 살펴보고 정답을 골라봐요." : "Look closely and choose your answer."}</p>}
        <fieldset className={vote ? styles.artOptions : styles.quizOptions} disabled={pending}>
          <legend className={styles.srOnly}>{question.text}</legend>
          {question.options.map((option, index) => {
            const checked = option.id === selected?.id;
            return <label key={option.id} className={styles.option} data-selected={checked}>
              <input type="radio" name={question.id} value={option.id} aria-label={option.label} checked={checked} onChange={() => onAnswer(question.id, option.id)} />
              {vote && option.media ? <div className={styles.optionImage}><Image unoptimized src={option.media.url} alt="" width={640} height={860} /></div> : <span className={styles.optionLetter} aria-hidden="true">{String.fromCharCode(65 + index)}</span>}
              <span className={styles.optionName}>{option.label}</span>
              {vote ? <><span className={styles.selectionMark} aria-hidden="true">{checked ? <CircleCheck /> : <Circle />}</span><span className={styles.selectionHint} aria-hidden="true">{checked ? (ko ? "MY PICK · 선택한 작품" : "MY PICK · Selected") : (ko ? "눌러서 작품 선택" : "Tap to choose")}</span></> : checked ? <Check className={styles.answerCheck} aria-hidden="true" /> : null}
            </label>;
          })}
        </fieldset>
        <p className={styles.credit}>{artworkCredit(current.description, ko)}</p>
      </section>
      <aside className={styles.confirmPanel} aria-label={ko ? "선택 확인" : "Confirm selection"}>
        {vote && <div className={styles.selectionSummary}>
          <p>{ko ? "선택한 작품" : "Your selected artwork"}</p>
          <h2>{selected?.label ?? (ko ? "작품을 골라주세요" : "Choose an artwork")}</h2>
          <p>{ko ? "이 작품으로 취향을 남길까요?" : "Ready to save your pick?"}</p>
        </div>}
        {current.attendanceRequired && <p className={styles.requirement}>{ko ? "LIVE 출석 인증 후 참여할 수 있어요." : "LIVE check-in is required to join."}</p>}
        <button className={styles.primary} data-pending={pending} type="button" disabled={pending || !selected} onClick={() => void confirm()}>{label}{!pending && <ArrowRight aria-hidden="true" />}</button>
        {vote && <p className={styles.changeHint}>{ko ? "다른 작품을 눌러 바꿀 수 있어요." : "Tap another artwork to change your pick."}</p>}
        {error && <div className={styles.error} role="alert"><p>{submissionMessage(errors[current.id], ko)}</p>
          {errors[current.id] === "MISSION_PASSPORT_REQUIRED" && <Link href={`/c/elina/verify?locale=${locale}&returnTo=${encodeURIComponent(`/live/${elinaLiveSlug}/missions?locale=${locale}`)}`}>{ko ? "팬 인증하기" : "Verify fandom"}</Link>}
          {errors[current.id] === "MISSION_ATTENDANCE_REQUIRED" && <Link href={`/live/${elinaLiveSlug}?locale=${locale}`}>{ko ? "LIVE로 돌아가기" : "Back to LIVE"}</Link>}
        </div>}
      </aside>
    </div>
  </main>;
}
