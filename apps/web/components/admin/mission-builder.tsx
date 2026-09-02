"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useState } from "react";
import styles from "./survey-builder.module.css";

type MissionType = "quiz" | "survey" | "vote";
type MediaType = "" | "image" | "video";
type OptionDraft = { labelKo: string; labelEn: string; mediaType: MediaType; mediaUrl: string };
type QuestionDraft = {
  textKo: string;
  textEn: string;
  mediaType: MediaType;
  mediaUrl: string;
  correctIndex: number;
  options: OptionDraft[];
};
const option = (): OptionDraft => ({ labelKo: "", labelEn: "", mediaType: "", mediaUrl: "" });
const question = (): QuestionDraft => ({ textKo: "", textEn: "", mediaType: "", mediaUrl: "", correctIndex: 0, options: [option(), option()] });
const media = (type: MediaType, url: string) => type && url ? { type, url } : null;

export function MissionBuilder({ liveEventId }: { liveEventId: string }) {
  const { getAccessToken } = usePrivy();
  const [type, setType] = useState<MissionType>("vote");
  const [attendanceRequirement, setAttendanceRequirement] = useState<"required" | "not_required">("not_required");
  const [titleKo, setTitleKo] = useState(""); const [titleEn, setTitleEn] = useState("");
  const [descriptionKo, setDescriptionKo] = useState(""); const [descriptionEn, setDescriptionEn] = useState("");
  const [questions, setQuestions] = useState<QuestionDraft[]>([question()]);
  const [created, setCreated] = useState(""); const [message, setMessage] = useState("");

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
        command: "create", type, attendanceRequirement,
        title: { ko: titleKo, en: titleEn }, description: { ko: descriptionKo, en: descriptionEn },
        questions: questions.map((item, questionIndex) => ({
          position: questionIndex + 1, text: { ko: item.textKo, en: item.textEn }, media: media(item.mediaType, item.mediaUrl),
          correctPosition: type === "quiz" ? item.correctIndex + 1 : null,
          options: item.options.map((value, optionIndex) => ({ position: optionIndex + 1, label: { ko: value.labelKo, en: value.labelEn }, media: media(value.mediaType, value.mediaUrl) })),
        })),
      });
      setCreated(result.missionId); setMessage("Mission draft created");
    } catch { setMessage("Mission could not be saved"); }
  }
  async function publish() { try { await command({ command: "publish", missionId: created }); setMessage("Mission published"); } catch { setMessage("Mission could not be published"); } }
  const incomplete = !titleKo || !titleEn || questions.some(item => !item.textKo || !item.textEn || item.options.some(value => !value.labelKo || !value.labelEn || Boolean(value.mediaType) !== Boolean(value.mediaUrl)) || Boolean(item.mediaType) !== Boolean(item.mediaUrl));

  return <main className={styles.page}>
    <header><p>ADM · Mission Builder</p><h1>Quiz · Survey · Vote</h1></header><p role="status">{message}</p>
    <div className={styles.localeGrid}>
      <label><span>Type</span><select value={type} onChange={event => setType(event.target.value as MissionType)}><option value="quiz">Quiz</option><option value="survey">Survey</option><option value="vote">Vote</option></select></label>
      <label><span>Attendance</span><select value={attendanceRequirement} onChange={event => setAttendanceRequirement(event.target.value as typeof attendanceRequirement)}><option value="not_required">Not required</option><option value="required">Required</option></select></label>
      <Text label="제목" value={titleKo} set={setTitleKo}/><Text label="Title" value={titleEn} set={setTitleEn}/>
      <Text label="설명" value={descriptionKo} set={setDescriptionKo}/><Text label="Description" value={descriptionEn} set={setDescriptionEn}/>
    </div>
    {questions.map((item, questionIndex) => <fieldset key={questionIndex}>
      <legend>Question {questionIndex + 1}</legend>
      <div className={styles.localeGrid}><Text label="질문" value={item.textKo} set={value => updateQuestion(questionIndex, { textKo: value })}/><Text label="Question" value={item.textEn} set={value => updateQuestion(questionIndex, { textEn: value })}/></div>
      <MediaFields type={item.mediaType} url={item.mediaUrl} set={(mediaType, mediaUrl) => updateQuestion(questionIndex, { mediaType, mediaUrl })}/>
      {item.options.map((value, optionIndex) => <div key={optionIndex} className={styles.localeGrid}>
        {type === "quiz" && <label><span>Correct</span><input type="radio" name={`correct-${questionIndex}`} checked={item.correctIndex === optionIndex} onChange={() => updateQuestion(questionIndex, { correctIndex: optionIndex })}/></label>}
        <Text label={`선택지 ${optionIndex + 1}`} value={value.labelKo} set={labelKo => updateOption(questionIndex, optionIndex, { labelKo })}/>
        <Text label={`Option ${optionIndex + 1}`} value={value.labelEn} set={labelEn => updateOption(questionIndex, optionIndex, { labelEn })}/>
        <MediaFields type={value.mediaType} url={value.mediaUrl} set={(mediaType, mediaUrl) => updateOption(questionIndex, optionIndex, { mediaType, mediaUrl })}/>
        {item.options.length > 2 && <button type="button" onClick={() => updateQuestion(questionIndex, { options: item.options.filter((_, index) => index !== optionIndex), correctIndex: 0 })}>Remove option</button>}
      </div>)}
      <button type="button" onClick={() => updateQuestion(questionIndex, { options: [...item.options, option()] })}>Add option</button>
      {questions.length > 1 && <button type="button" onClick={() => setQuestions(current => current.filter((_, index) => index !== questionIndex))}>Remove question</button>}
    </fieldset>)}
    <div className={styles.actions}><button type="button" onClick={() => setQuestions(current => [...current, question()])}>Add question</button><button type="button" onClick={() => void create()} disabled={incomplete}>Create draft</button><button type="button" onClick={() => void publish()} disabled={!created}>Publish</button></div>
  </main>;
}
function Text({label,value,set}:{label:string;value:string;set(value:string):void}){return <label><span>{label}</span><input value={value} onChange={event=>set(event.target.value)}/></label>;}
function MediaFields({type,url,set}:{type:MediaType;url:string;set(type:MediaType,url:string):void}){return <div className={styles.localeGrid}><label><span>Media</span><select value={type} onChange={event=>set(event.target.value as MediaType,url)}><option value="">None</option><option value="image">Image</option><option value="video">Video</option></select></label><Text label="Media URL" value={url} set={value=>set(type,value)}/></div>;}
