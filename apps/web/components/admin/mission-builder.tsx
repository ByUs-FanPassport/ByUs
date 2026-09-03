"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";
import styles from "./survey-builder.module.css";

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
  const { getAccessToken } = usePrivy();
  const [type, setType] = useState<MissionType>("vote");
  const [attendanceRequirement, setAttendanceRequirement] = useState<"required" | "not_required">("not_required");
  const [titleKo, setTitleKo] = useState(""); const [titleEn, setTitleEn] = useState("");
  const [descriptionKo, setDescriptionKo] = useState(""); const [descriptionEn, setDescriptionEn] = useState("");
  const [visibleFrom, setVisibleFrom] = useState(""); const [visibleUntil, setVisibleUntil] = useState("");
  const [questions, setQuestions] = useState<QuestionDraft[]>([question()]);
  const [created, setCreated] = useState(""); const [message, setMessage] = useState(""); const [statistics, setStatistics] = useState<MissionStatistics[]>([]);

  const loadStatistics = useCallback(async () => {
    const token = await getAccessToken(); const response = await fetch(`/api/admin/live-events/${liveEventId}/missions`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!response.ok) return; const body = await response.json() as { missions?: MissionStatistics[] }; setStatistics(Array.isArray(body.missions) ? body.missions : []);
  }, [getAccessToken, liveEventId]);
  useEffect(() => { void loadStatistics(); }, [loadStatistics]);

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
      setCreated(result.missionId); setMessage("Mission draft created"); await loadStatistics();
    } catch { setMessage("Mission could not be saved"); }
  }
  async function update() {
    try {
      await command({ command: "update", missionId: created, type, attendanceRequirement, visibleFrom: new Date(visibleFrom).toISOString(), visibleUntil: new Date(visibleUntil).toISOString(), title: { ko: titleKo, en: titleEn }, description: { ko: descriptionKo, en: descriptionEn }, questions: questions.map((item, questionIndex) => ({ position: questionIndex + 1, text: { ko: item.textKo, en: item.textEn }, media: media(item.mediaType, item.mediaUrl), correctPosition: type === "quiz" ? item.correctIndex + 1 : null, options: item.options.map((value, optionIndex) => ({ position: optionIndex + 1, label: { ko: value.labelKo, en: value.labelEn }, displayMode: value.displayMode, media: media(value.mediaType, value.mediaUrl) })) })) });
      setMessage("Mission draft updated"); await loadStatistics();
    } catch { setMessage("Mission could not be updated"); }
  }
  async function publish() { try { await command({ command: "publish", missionId: created }); setMessage("Mission published"); await loadStatistics(); } catch { setMessage("Mission could not be published"); } }
  const incomplete = !titleKo || !titleEn || !visibleFrom || !visibleUntil || Date.parse(visibleFrom) >= Date.parse(visibleUntil) || questions.some(item => !item.textKo || !item.textEn || item.options.some(value => !value.labelKo || !value.labelEn || Boolean(value.mediaType) !== Boolean(value.mediaUrl) || (value.displayMode === "text") !== !value.mediaType) || Boolean(item.mediaType) !== Boolean(item.mediaUrl));

  return <main className={styles.page}>
    <header><p>ADM · Mission Builder</p><h1>Quiz · Survey · Vote</h1></header><p role="status">{message}</p>
    <div className={styles.localeGrid}>
      <label><span>Type</span><select value={type} onChange={event => setType(event.target.value as MissionType)}><option value="quiz">Quiz</option><option value="survey">Survey</option><option value="vote">Vote</option></select></label>
      <label><span>Attendance</span><select value={attendanceRequirement} onChange={event => setAttendanceRequirement(event.target.value as typeof attendanceRequirement)}><option value="not_required">Not required</option><option value="required">Required</option></select></label>
      <Text label="제목" value={titleKo} set={setTitleKo}/><Text label="Title" value={titleEn} set={setTitleEn}/>
      <Text label="설명" value={descriptionKo} set={setDescriptionKo}/><Text label="Description" value={descriptionEn} set={setDescriptionEn}/>
      <DateTime label="Visible from" value={visibleFrom} set={setVisibleFrom}/><DateTime label="Visible until" value={visibleUntil} set={setVisibleUntil}/>
    </div>
    {questions.map((item, questionIndex) => <fieldset key={questionIndex}>
      <legend>Question {questionIndex + 1}</legend>
      <div className={styles.localeGrid}><Text label="질문" value={item.textKo} set={value => updateQuestion(questionIndex, { textKo: value })}/><Text label="Question" value={item.textEn} set={value => updateQuestion(questionIndex, { textEn: value })}/></div>
      <MediaFields type={item.mediaType} url={item.mediaUrl} set={(mediaType, mediaUrl) => updateQuestion(questionIndex, { mediaType, mediaUrl })}/>
      {item.options.map((value, optionIndex) => <div key={optionIndex} className={styles.localeGrid}>
        {type === "quiz" && <label><span>Correct</span><input type="radio" name={`correct-${questionIndex}`} checked={item.correctIndex === optionIndex} onChange={() => updateQuestion(questionIndex, { correctIndex: optionIndex })}/></label>}
        <Text label={`선택지 ${optionIndex + 1}`} value={value.labelKo} set={labelKo => updateOption(questionIndex, optionIndex, { labelKo })}/>
        <Text label={`Option ${optionIndex + 1}`} value={value.labelEn} set={labelEn => updateOption(questionIndex, optionIndex, { labelEn })}/>
        <label><span>Display</span><select value={value.displayMode} onChange={event=>updateOption(questionIndex,optionIndex,{displayMode:event.target.value as OptionDraft["displayMode"]})}><option value="text">Text</option><option value="media">Media only</option><option value="text_media">Text + media</option></select></label>
        <MediaFields type={value.mediaType} url={value.mediaUrl} set={(mediaType, mediaUrl) => updateOption(questionIndex, optionIndex, { mediaType, mediaUrl })}/>
        {item.options.length > 2 && <button type="button" onClick={() => updateQuestion(questionIndex, { options: item.options.filter((_, index) => index !== optionIndex), correctIndex: 0 })}>Remove option</button>}
      </div>)}
      <button type="button" onClick={() => updateQuestion(questionIndex, { options: [...item.options, option()] })}>Add option</button>
      {questions.length > 1 && <button type="button" onClick={() => setQuestions(current => current.filter((_, index) => index !== questionIndex))}>Remove question</button>}
    </fieldset>)}
    <div className={styles.actions}><button type="button" onClick={() => setQuestions(current => [...current, question()])}>Add question</button><button type="button" onClick={() => void create()} disabled={incomplete}>Create draft</button><button type="button" onClick={() => void update()} disabled={!created || incomplete}>Update draft</button><button type="button" onClick={() => void publish()} disabled={!created}>Publish</button></div>
    <section aria-labelledby="mission-statistics"><h2 id="mission-statistics">Mission statistics</h2><button type="button" onClick={() => void loadStatistics()}>Refresh statistics</button>
      {statistics.length === 0 ? <p>No Mission statistics yet.</p> : statistics.map(mission => <article key={mission.missionId}><h3>{mission.title} · {mission.type.toUpperCase()}</h3><p>Total participants: <strong>{mission.totalParticipants}</strong></p>{mission.type === "quiz" && <p>Correct / Incorrect: <strong>{mission.correctCount} / {mission.incorrectCount}</strong></p>}{mission.questions.map(questionItem => <div key={questionItem.questionId}><h4>{questionItem.text}</h4><ul>{questionItem.options.map(optionItem => <li key={optionItem.optionId}>{optionItem.label}: <strong>{optionItem.optionCount}</strong></li>)}</ul></div>)}</article>)}
    </section>
  </main>;
}
function Text({label,value,set}:{label:string;value:string;set(value:string):void}){return <label><span>{label}</span><input value={value} onChange={event=>set(event.target.value)}/></label>;}
function DateTime({label,value,set}:{label:string;value:string;set(value:string):void}){return <label><span>{label}</span><input type="datetime-local" value={value} onChange={event=>set(event.target.value)}/></label>;}
function MediaFields({type,url,set}:{type:MediaType;url:string;set(type:MediaType,url:string):void}){return <div className={styles.localeGrid}><label><span>Media</span><select value={type} onChange={event=>set(event.target.value as MediaType,url)}><option value="">None</option><option value="image">Image</option><option value="video">Video</option></select></label><Text label="Media URL" value={url} set={value=>set(type,value)}/></div>;}
