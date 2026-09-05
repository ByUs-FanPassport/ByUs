"use client";
import Link from "next/link";
import { liveEventResponseSchema } from "../domain/live-event";
import { FanState } from "../../../components/fan-ui/fan-state";
import Image from "next/image";
import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useState } from "react";
import { liveMissionListSchema, liveMissionSchema } from "../domain/live-mission";
import type { z } from "zod";
import styles from "./live-mission-screen.module.css";
type Mission=z.infer<typeof liveMissionSchema>;
export function LiveMissionScreen({slug,locale}:{slug:string;locale:"ko"|"en"}){
  const {ready,authenticated,login,getAccessToken}=usePrivy();const [loadState,setLoadState]=useState<"loading"|"ready"|"error">("loading");const [retry,setRetry]=useState(0);const [title,setTitle]=useState("");const [missions,setMissions]=useState<Mission[]>([]);const [answers,setAnswers]=useState<Record<string,string>>({});const [message,setMessage]=useState("");
  useEffect(()=>{
    const controller=new AbortController();setTitle("");
    void fetch(`/api/live-events/${encodeURIComponent(slug)}?locale=${locale}`,{signal:controller.signal,cache:"no-store"})
      .then(async response=>{if(response.ok){const body=liveEventResponseSchema.parse(await response.json());if(!controller.signal.aborted)setTitle(body.live.title);}}).catch(()=>{});
    return ()=>controller.abort();
  },[slug,locale]);
  useEffect(()=>{
    if(!ready||!authenticated)return;
    const controller=new AbortController();setLoadState("loading");setMissions([]);
    void (async()=>{
      const token=await getAccessToken();if(!token)throw new Error("Missing token");
      const response=await fetch(`/api/live-events/${encodeURIComponent(slug)}/missions?locale=${locale}`,{signal:controller.signal,headers:{authorization:`Bearer ${token}`},cache:"no-store"});
      if(!response.ok)throw new Error("Mission request failed");
      const data=liveMissionListSchema.parse(await response.json());
      if(!controller.signal.aborted){setMissions(data);setLoadState("ready");}
    })().catch(()=>{if(!controller.signal.aborted)setLoadState("error");});
    return ()=>controller.abort();
  },[ready,authenticated,getAccessToken,locale,slug,retry]);
  async function submit(mission:Mission){
    const token=await getAccessToken();
    const response=await fetch(`/api/missions/${mission.id}/submit`,{
      method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},
      body:JSON.stringify({idempotencyKey:crypto.randomUUID(),answers:mission.questions.map(q=>({questionId:q.id,selectedOptionIds:[answers[q.id]]}))}),
    });
    setMessage(response.ok?(locale==="ko"?"미션을 완료했어요. 보상과 Stamp가 기록되었습니다.":"Mission complete. Your rewards and Stamp were recorded."):(locale==="ko"?"미션을 완료하지 못했어요.":"Mission could not be completed."));
  }
  const back=<Link className={styles.back} href={`/live/${slug}?locale=${locale}`}>{locale==="ko"?"LIVE로 돌아가기":"Back to LIVE"}</Link>;
  if(!ready)return <main className={styles.page}>{back}<FanState kind="loading" title={locale==="ko"?"참여 정보를 확인하고 있어요.":"Checking participation."}/></main>;
  if(!authenticated)return <main className={styles.page}>{back}<h1>{locale==="ko"?"LIVE 미션":"LIVE Missions"}</h1><button onClick={login}>{locale==="ko"?"로그인하고 참여하기":"Sign in to join"}</button></main>;
  return <main className={styles.page}>{back}<header><p>{title || (locale==="ko"?"LIVE 참여 미션":"LIVE participation")}</p><h1>{locale==="ko"?"미션":"Missions"}</h1></header>{message&&<p role="status" className={styles.notice}>{message}</p>}{loadState==="loading"?<FanState kind="loading" title={locale==="ko"?"미션을 불러오고 있어요.":"Loading missions."}/>:loadState==="error"?<FanState kind="error" title={locale==="ko"?"미션을 불러오지 못했어요.":"Could not load missions."} actions={<button onClick={()=>setRetry(value=>value+1)}>{locale==="ko"?"다시 시도":"Try again"}</button>}/>:missions.length===0?<p>{locale==="ko"?"지금 참여할 수 있는 미션이 없어요.":"No missions are available right now."}</p>:missions.map(m=><article key={m.id} className={styles.card}><span>{m.type.toUpperCase()}</span><h2>{m.title}</h2><p>{m.description}</p>{m.questions.map(q=><fieldset key={q.id}><legend>{q.text}</legend>{q.media&&<Media value={q.media} alt={q.text}/>} {q.options.map(o=><label key={o.id} className={styles.option}><input aria-label={o.label} type="radio" name={q.id} checked={answers[q.id]===o.id} onChange={()=>setAnswers(v=>({...v,[q.id]:o.id}))}/>{o.media&&<Media value={o.media} alt=""/>}{o.displayMode!=="media"&&<span>{o.label}</span>}</label>)}</fieldset>)}<button disabled={m.completed||m.questions.some(q=>!answers[q.id])} onClick={()=>void submit(m)}>{m.completed?(locale==="ko"?"완료됨":"Completed"):(locale==="ko"?"미션 완료":"Complete mission")}</button></article>)}</main>;
}
function Media({value,alt}:{value:{type:"image"|"video";url:string};alt:string}){return value.type==="video"?<video aria-label={alt||undefined} controls preload="metadata" src={value.url}/>:<Image unoptimized src={value.url} alt={alt} width={640} height={360}/>;}
