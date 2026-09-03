"use client";
import Image from "next/image";
import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useState } from "react";
import { liveMissionListSchema, liveMissionSchema } from "../domain/live-mission";
import type { z } from "zod";
import styles from "./live-mission-screen.module.css";
type Mission=z.infer<typeof liveMissionSchema>;
export function LiveMissionScreen({slug,locale}:{slug:string;locale:"ko"|"en"}){
  const {authenticated,login,getAccessToken}=usePrivy();const [missions,setMissions]=useState<Mission[]>([]);const [answers,setAnswers]=useState<Record<string,string>>({});const [message,setMessage]=useState("");
  useEffect(()=>{if(!authenticated)return;void getAccessToken().then(async token=>{const response=await fetch(`/api/live-events/${slug}/missions?locale=${locale}`,{headers:{authorization:`Bearer ${token}`},cache:"no-store"});if(response.ok)setMissions(liveMissionListSchema.parse(await response.json()));});},[authenticated,getAccessToken,locale,slug]);
  async function submit(mission:Mission){
    const token=await getAccessToken();
    const response=await fetch(`/api/missions/${mission.id}/submit`,{
      method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},
      body:JSON.stringify({idempotencyKey:crypto.randomUUID(),answers:mission.questions.map(q=>({questionId:q.id,selectedOptionIds:[answers[q.id]]}))}),
    });
    setMessage(response.ok?(locale==="ko"?"미션을 완료했어요. 보상과 Stamp가 기록되었습니다.":"Mission complete. Your rewards and Stamp were recorded."):(locale==="ko"?"미션을 완료하지 못했어요.":"Mission could not be completed."));
  }
  if(!authenticated)return <main className={styles.page}><h1>LIVE Missions</h1><button onClick={login}>{locale==="ko"?"로그인하고 참여하기":"Sign in to join"}</button></main>;
  return <main className={styles.page}><header><p>LIVE · {slug}</p><h1>{locale==="ko"?"미션":"Missions"}</h1></header>{message&&<p role="status" className={styles.notice}>{message}</p>}{missions.length===0?<p>{locale==="ko"?"진행할 수 있는 미션이 없습니다.":"No missions are available."}</p>:missions.map(m=><article key={m.id} className={styles.card}><span>{m.type.toUpperCase()}</span><h2>{m.title}</h2><p>{m.description}</p>{m.questions.map(q=><fieldset key={q.id}><legend>{q.text}</legend>{q.media&&<Media value={q.media} alt={q.text}/>} {q.options.map(o=><label key={o.id} className={styles.option}><input aria-label={o.label} type="radio" name={q.id} checked={answers[q.id]===o.id} onChange={()=>setAnswers(v=>({...v,[q.id]:o.id}))}/>{o.media&&<Media value={o.media} alt=""/>}{o.displayMode!=="media"&&<span>{o.label}</span>}</label>)}</fieldset>)}<button disabled={m.completed||m.questions.some(q=>!answers[q.id])} onClick={()=>void submit(m)}>{m.completed?(locale==="ko"?"완료됨":"Completed"):(locale==="ko"?"미션 완료":"Complete mission")}</button></article>)}</main>;
}
function Media({value,alt}:{value:{type:"image"|"video";url:string};alt:string}){return value.type==="video"?<video aria-label={alt||undefined} controls preload="metadata" src={value.url}/>:<Image unoptimized src={value.url} alt={alt} width={640} height={360}/>;}
