"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";
import { AdminAccessState } from "./admin-access-state";
import { AdminOperationsShell } from "./operations-shell";
import { useAdminSession } from "./use-admin-session";
import styles from "./mission-builder.module.css";

type MissionType = "quiz" | "survey" | "vote";
type MediaType = "" | "image" | "video";
type OptionDraft = { labelKo: string; labelEn: string; displayMode: "text" | "media" | "text_media"; mediaType: MediaType; mediaUrl: string };
type QuestionDraft = {
  textKo: string;
  textEn: string;
  mediaType: MediaType;
  mediaUrl: string;
  correctIndex: number;
  options: OptionDraft[];
};
type MissionStatistics = { missionId: string; type: MissionType; title: string; visibleFrom: string; visibleUntil: string; totalParticipants: number; correctCount: number; incorrectCount: number; questions: { questionId: string; text: string; options: { optionId: string; label: string; optionCount: number }[] }[] };
const option = (): OptionDraft => ({ labelKo: "", labelEn: "", displayMode: "text", mediaType: "", mediaUrl: "" });
const question = (): QuestionDraft => ({ textKo: "", textEn: "", mediaType: "", mediaUrl: "", correctIndex: 0, options: [option(), option()] });
const media = (type: MediaType, url: string) => type && url ? { type, url } : null;

export function MissionBuilder({ liveEventId }: { liveEventId: string }) {
  const session = useAdminSession();
  const { getAccessToken } = usePrivy();
  const [type, setType] = useState<MissionType>("vote");
  const [attendanceRequirement, setAttendanceRequirement] = useState<"required" | "not_required">("not_required");
  const [titleKo, setTitleKo] = useState(""); const [titleEn, setTitleEn] = useState("");
  const [descriptionKo, setDescriptionKo] = useState(""); const [descriptionEn, setDescriptionEn] = useState("");
  const [visibleFrom, setVisibleFrom] = useState(""); const [visibleUntil, setVisibleUntil] = useState("");
  const [questions, setQuestions] = useState<QuestionDraft[]>([question()]);
  const [created, setCreated] = useState(""); const [message, setMessage] = useState(""); const [statistics, setStatistics] = useState<MissionStatistics[]>([]); const [statisticsState, setStatisticsState] = useState<"loading"|"ready"|"error">("loading"); const [saving, setSaving] = useState(false);

  const loadStatistics = useCallback(async () => {
    setStatisticsState("loading");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("UNAUTHENTICATED");
      const response = await fetch(`/api/admin/live-events/${liveEventId}/missions`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const body = await response.json() as { missions?: MissionStatistics[] };
      setStatistics(Array.isArray(body.missions) ? body.missions : []);
      setStatisticsState("ready");
    } catch { setStatisticsState("error"); }
  }, [getAccessToken, liveEventId]);
  useEffect(() => { if (session.status === "authorized") void loadStatistics(); }, [loadStatistics, session.status]);

  async function command(body: unknown) {
    const token = await getAccessToken();
    const response = await fetch(`/api/admin/live-events/${liveEventId}/missions`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-correlation-id": crypto.randomUUID() },
      body: JSON.stringify(body),
    });
    const data = await response.json(); if (!response.ok) throw new Error(); return data as { missionId: string };
  }
  function updateQuestion(index: number, patch: Partial<QuestionDraft>) { setQuestions(current => current.map((item, i) => i === index ? { ...item, ...patch } : item)); }
  function updateOption(questionIndex: number, optionIndex: number, patch: Partial<OptionDraft>) {
    setQuestions(current => current.map((item, i) => i === questionIndex ? { ...item, options: item.options.map((value, j) => j === optionIndex ? { ...value, ...patch } : value) } : item));
  }
  async function create() {
    if (saving) return;
    setSaving(true);
    try {
      const result = await command({
        command: "create", type, attendanceRequirement, visibleFrom: new Date(visibleFrom).toISOString(), visibleUntil: new Date(visibleUntil).toISOString(),
        title: { ko: titleKo, en: titleEn }, description: { ko: descriptionKo, en: descriptionEn },
        questions: questions.map((item, questionIndex) => ({
          position: questionIndex + 1, text: { ko: item.textKo, en: item.textEn }, media: media(item.mediaType, item.mediaUrl),
          correctPosition: type === "quiz" ? item.correctIndex + 1 : null,
          options: item.options.map((value, optionIndex) => ({ position: optionIndex + 1, label: { ko: value.labelKo, en: value.labelEn }, displayMode: value.displayMode, media: media(value.mediaType, value.mediaUrl) })),
        })),
      });
      setCreated(result.missionId); setMessage("미션 초안을 만들었습니다."); await loadStatistics();
    } catch { setMessage("미션 초안을 저장하지 못했습니다."); } finally { setSaving(false); }
  }
  async function update() {
    if (saving) return;
    setSaving(true);
    try {
      await command({ command: "update", missionId: created, type, attendanceRequirement, visibleFrom: new Date(visibleFrom).toISOString(), visibleUntil: new Date(visibleUntil).toISOString(), title: { ko: titleKo, en: titleEn }, description: { ko: descriptionKo, en: descriptionEn }, questions: questions.map((item, questionIndex) => ({ position: questionIndex + 1, text: { ko: item.textKo, en: item.textEn }, media: media(item.mediaType, item.mediaUrl), correctPosition: type === "quiz" ? item.correctIndex + 1 : null, options: item.options.map((value, optionIndex) => ({ position: optionIndex + 1, label: { ko: value.labelKo, en: value.labelEn }, displayMode: value.displayMode, media: media(value.mediaType, value.mediaUrl) })) })) });
      setMessage("미션 초안을 수정했습니다."); await loadStatistics();
    } catch { setMessage("미션 초안을 수정하지 못했습니다."); } finally { setSaving(false); }
  }
  async function publish() { if (saving) return; setSaving(true); try { await command({ command: "publish", missionId: created }); setMessage("미션을 발행했습니다."); await loadStatistics(); } catch { setMessage("미션을 발행하지 못했습니다."); } finally { setSaving(false); } }
  const incomplete = !titleKo || !titleEn || !visibleFrom || !visibleUntil || Date.parse(visibleFrom) >= Date.parse(visibleUntil) || questions.some(item => !item.textKo || !item.textEn || item.options.some(value => !value.labelKo || !value.labelEn || Boolean(value.mediaType) !== Boolean(value.mediaUrl) || (value.displayMode === "text") !== !value.mediaType) || Boolean(item.mediaType) !== Boolean(item.mediaUrl));

  if (session.status !== "authorized") return <AdminAccessState status={session.status} locale="ko" />;
  return <AdminOperationsShell locale="ko" adminRole={session.admin.role}>
    <div className={styles.page}>
    <header className={styles.heading}><p>라이브 운영</p><h1>미션 빌더</h1><span>퀴즈·설문·투표의 노출 기간과 한국어·영어 문항을 구성합니다.</span></header>
    {session.admin.role === "viewer" && <p className={styles.notice}>Viewer 역할은 미션 현황만 조회할 수 있습니다.</p>}
    {message && <p className={styles.message} role="status">{message}</p>}
    <section className={styles.card} aria-labelledby="mission-settings"><h2 id="mission-settings">기본 설정</h2><div className={styles.localeGrid}>
      <label><span>미션 유형</span><select value={type} onChange={event => setType(event.target.value as MissionType)}><option value="quiz">퀴즈</option><option value="survey">설문</option><option value="vote">투표</option></select></label>
      <label><span>출석 조건</span><select value={attendanceRequirement} onChange={event => setAttendanceRequirement(event.target.value as typeof attendanceRequirement)}><option value="not_required">필수 아님</option><option value="required">필수</option></select></label>
      <Text label="제목" value={titleKo} set={setTitleKo}/><Text label="Title" value={titleEn} set={setTitleEn}/>
      <Text label="설명" value={descriptionKo} set={setDescriptionKo}/><Text label="Description" value={descriptionEn} set={setDescriptionEn}/>
      <DateTime label="공개 시작" value={visibleFrom} set={setVisibleFrom}/><DateTime label="공개 종료" value={visibleUntil} set={setVisibleUntil}/>
    </div></section>
    <section className={styles.questions} aria-labelledby="mission-questions"><h2 id="mission-questions">문항</h2>{questions.map((item, questionIndex) => <fieldset key={questionIndex}>
      <legend>Question {questionIndex + 1}</legend>
      <div className={styles.localeGrid}><Text label="질문" value={item.textKo} set={value => updateQuestion(questionIndex, { textKo: value })}/><Text label="Question" value={item.textEn} set={value => updateQuestion(questionIndex, { textEn: value })}/></div>
      <MediaFields type={item.mediaType} url={item.mediaUrl} set={(mediaType, mediaUrl) => updateQuestion(questionIndex, { mediaType, mediaUrl })}/>
      {item.options.map((value, optionIndex) => <div key={optionIndex} className={styles.localeGrid}>
        {type === "quiz" && <label className={styles.radioLabel}><span>정답</span><input type="radio" name={`correct-${questionIndex}`} checked={item.correctIndex === optionIndex} onChange={() => updateQuestion(questionIndex, { correctIndex: optionIndex })}/></label>}
        <Text label={`선택지 ${optionIndex + 1}`} value={value.labelKo} set={labelKo => updateOption(questionIndex, optionIndex, { labelKo })}/>
        <Text label={`Option ${optionIndex + 1}`} value={value.labelEn} set={labelEn => updateOption(questionIndex, optionIndex, { labelEn })}/>
        <label><span>Display</span><select value={value.displayMode} onChange={event=>updateOption(questionIndex,optionIndex,{displayMode:event.target.value as OptionDraft["displayMode"]})}><option value="text">Text</option><option value="media">Media only</option><option value="text_media">Text + media</option></select></label>
        <MediaFields type={value.mediaType} url={value.mediaUrl} set={(mediaType, mediaUrl) => updateOption(questionIndex, optionIndex, { mediaType, mediaUrl })}/>
        {item.options.length > 2 && <button type="button" onClick={() => updateQuestion(questionIndex, { options: item.options.filter((_, index) => index !== optionIndex), correctIndex: 0 })}>Remove option</button>}
      </div>)}
      <button type="button" onClick={() => updateQuestion(questionIndex, { options: [...item.options, option()] })}>Add option</button>
      {questions.length > 1 && <button type="button" onClick={() => setQuestions(current => current.filter((_, index) => index !== questionIndex))}>Remove question</button>}
    </fieldset>)}</section>
    <div className={styles.actions}><button type="button" onClick={() => setQuestions(current => [...current, question()])}>문항 추가</button><button type="button" onClick={() => void create()} disabled={session.admin.role === "viewer" || saving || incomplete}>{saving ? "처리 중…" : "초안 만들기"}</button><button type="button" onClick={() => void update()} disabled={session.admin.role === "viewer" || saving || !created || incomplete}>초안 수정</button><button type="button" onClick={() => void publish()} disabled={session.admin.role === "viewer" || saving || !created}>발행</button></div>
    <section className={styles.statistics} aria-labelledby="mission-statistics"><div className={styles.sectionHead}><h2 id="mission-statistics">미션 통계</h2><button type="button" onClick={() => void loadStatistics()}>통계 새로고침</button></div>
      {statisticsState === "loading" ? <p className={styles.empty} role="status">미션 통계를 불러오는 중입니다.</p> : statisticsState === "error" ? <div className={styles.empty}><p role="alert">미션 통계를 불러오지 못했습니다.</p><button type="button" onClick={() => void loadStatistics()}>다시 시도</button></div> : statistics.length === 0 ? <p className={styles.empty}>아직 집계된 미션 통계가 없습니다.</p> : statistics.map(mission => <article key={mission.missionId}><h3>{mission.title} · {mission.type.toUpperCase()}</h3><p>참여자: <strong>{mission.totalParticipants}</strong></p>{mission.type === "quiz" && <p>정답 / 오답: <strong>{mission.correctCount} / {mission.incorrectCount}</strong></p>}{mission.questions.map(questionItem => <div key={questionItem.questionId}><h4>{questionItem.text}</h4><ul>{questionItem.options.map(optionItem => <li key={optionItem.optionId}>{optionItem.label}: <strong>{optionItem.optionCount}</strong></li>)}</ul></div>)}</article>)}
    </section>
  </div>
  </AdminOperationsShell>;
}
function Text({label,value,set}:{label:string;value:string;set(value:string):void}){return <label><span>{label}</span><input value={value} onChange={event=>set(event.target.value)}/></label>;}
function DateTime({label,value,set}:{label:string;value:string;set(value:string):void}){return <label><span>{label}</span><input type="datetime-local" value={value} onChange={event=>set(event.target.value)}/></label>;}
function MediaFields({type,url,set}:{type:MediaType;url:string;set(type:MediaType,url:string):void}){return <div className={styles.localeGrid}><label><span>Media</span><select value={type} onChange={event=>set(event.target.value as MediaType,url)}><option value="">None</option><option value="image">Image</option><option value="video">Video</option></select></label><Text label="Media URL" value={url} set={value=>set(type,value)}/></div>;}
