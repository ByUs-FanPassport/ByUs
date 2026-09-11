"use client";
import { fanpageSummarySchema } from "../domain/community";
import { useFanpageResource } from "./use-fanpage-resource";
import styles from "./fanpage.module.css";
const parse = (value: unknown) => fanpageSummarySchema.parse(value);
export function FanActivityPanel({ slug, locale }: { slug: string; locale: "ko" | "en" }) {
  const resource = useFanpageResource(`/api/celebrities/${slug}/fanpage?locale=${locale}`, parse, true);
  const ko = locale === "ko";
  return <section className={styles.activity}><h2>{ko ? "함께하는 팬들" : "Fan community"}</h2>{resource.state.status === "ready" ? resource.state.data.activity.length ? <ul>{resource.state.data.activity.map((event, index) => <li key={`${event.occurredAt}:${index}`}><img src={event.avatarUrl} width={32} height={32} alt="" /><p><strong>{event.nickname}</strong>{ko ? (event.kind === "joined" ? "님이 팬 여정을 시작했어요." : event.kind === "level_up" ? "님이 새로운 팬 등급에 올랐어요." : "님이 첫 인증을 마쳤어요.") : (event.kind === "joined" ? " started their fan journey." : event.kind === "level_up" ? " reached a new fan tier." : " completed their first verification.")}</p></li>)}</ul> : <p className={styles.muted}>{ko ? "새로운 팬 활동을 기다리고 있어요." : "Waiting for new fan activity."}</p> : <p className={styles.muted}>{ko ? (resource.state.status === "error" ? "팬 활동을 불러오지 못했어요." : "팬 활동을 확인하고 있어요.") : "Checking fan activity."}</p>}
    {resource.refreshFailed && <p className={styles.muted}>{ko ? "팬 활동을 갱신하지 못했어요." : "Couldn't refresh fan activity."} <button onClick={resource.retry}>{ko ? "다시 시도" : "Try again"}</button></p>}
  </section>;
}
