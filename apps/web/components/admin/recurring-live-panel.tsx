"use client";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import type { RecurringReviewCommand } from "../../server/g5/recurring-live-route";
import type { AdminLocale } from "./operations-shell";
import styles from "./recurring-live-panel.module.css";

const observation = z.object({ sourceUrl: z.string().nullable(), originalText: z.string().nullable(), observedAt: z.string() });
const review = z.object({
  id: z.string().uuid(), seriesId: z.string().uuid(), celebrityName: z.string(), revision: z.number(), reason: z.string(),
  rule: z.unknown(), currentRule: z.unknown().optional(), expectedCurrentRevisionId: z.string().uuid().nullable(),
  observations: z.array(observation).default([]),
  reviewPayload: z.object({ candidateEventIds: z.array(z.string().uuid()).optional(), candidateEvents: z.array(z.object({ id:z.string().uuid(),slug:z.string(),startsAt:z.string(),title:z.string(),reservationCount:z.number() })).optional() }).passthrough().optional(),
});
const panelSchema = z.object({
  reviews: z.array(review),
  roster: z.object({ celebrities: z.array(z.object({
    id: z.string().uuid(), slug: z.string(), nameKo: z.string(), nameEn: z.string(),
    latestObservation: z.object({ result: z.string(), verification: z.string(), observedAt: z.string() }).nullable().optional(),
  })) }),
});
type Panel = z.infer<typeof panelSchema>;
function RuleSummary({ value, ko }: { value: unknown; ko: boolean }) {
  const rule = z.object({ timeZone: z.string(), effectiveFrom: z.string(), effectiveUntil: z.string().nullable(), provider: z.string(), slots: z.array(z.object({ isoWeekday: z.number(), localStartTime: z.string() })) }).safeParse(value);
  if (!rule.success) return <p>{ko ? "승인된 반복 규칙 없음" : "No approved recurring rule"}</p>;
  const weekdays = ko ? ["", "월", "화", "수", "목", "금", "토", "일"] : ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return <><p>{rule.data.provider} · {rule.data.timeZone}</p><ul>{rule.data.slots.map((slot, index) => <li key={index}>{weekdays[slot.isoWeekday]} {slot.localStartTime}</li>)}</ul><p>{rule.data.effectiveFrom}{rule.data.effectiveUntil ? ` – ${rule.data.effectiveUntil}` : ""}</p></>;
}
export function RecurringLivePanel({ locale, role, getAccessToken }: { locale: AdminLocale; role: string; getAccessToken(): Promise<string | null> }) {
  const [data, setData] = useState<Panel | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [selectedEvents, setSelectedEvents] = useState<Record<string, string[]>>({});
  const ko = locale === "ko";
  const request = useCallback(async (body?: unknown) => {
    const token = await getAccessToken();
    if (!token) throw new Error("auth");
    const result = await fetch("/api/admin/recurring-lives", {
      method: body ? "POST" : "GET", cache: "no-store",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-correlation-id": crypto.randomUUID() },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!result.ok) throw new Error(result.status === 409 ? "conflict" : "unavailable");
    return result.json();
  }, [getAccessToken]);
  const refresh = useCallback(async () => {
    try { const result = panelSchema.parse(await request()); setData(result); setError(""); }
    catch { setError(ko ? "정기 방송 정보를 불러오지 못했습니다." : "Recurring schedules could not be loaded."); }
  }, [request, ko]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function resolve(item: Panel["reviews"][number], resolution: RecurringReviewCommand["resolution"]) {
    if (pending || role === "viewer") return;
    setPending(item.id); setError("");
    try {
      await request({ revisionId: item.id, expectedCurrentRevisionId: item.expectedCurrentRevisionId,
        resolution });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error && cause.message === "conflict"
        ? ko ? "검토 중 규칙이 변경됐습니다. 새로고침 후 다시 확인해 주세요." : "The rule changed during review. Refresh before continuing."
        : ko ? "검토 결과를 저장하지 못했습니다." : "The review could not be saved.");
    } finally { setPending(null); }
  }
  return <section className={styles.panel} aria-labelledby="recurring-live-title">
    <div className={styles.heading}><div><h2 id="recurring-live-title">{ko ? "정기 방송" : "Recurring LIVE"}</h2><p>{ko ? "공식 규칙으로 회차를 생성합니다. 각 회차는 라이브 목록에서 관리하고 예약할 수 있습니다." : "Official rules generate individual LIVE events that can be managed and reserved."}</p></div><button type="button" onClick={() => void refresh()} disabled={pending !== null}>{ko ? "새로고침" : "Refresh"}</button></div>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">{ko ? "정기 방송 정보를 불러오는 중입니다." : "Loading recurring schedules."}</p>}
    {data && <><ul className={styles.roster}>{data.roster.celebrities.map(creator => <li key={creator.id}>
      <strong>{ko ? creator.nameKo : creator.nameEn}</strong><span>{creator.latestObservation?.result === "regular" ? ko ? "정기 규칙 확인" : "Regular rule found" : creator.latestObservation?.result === "irregular" ? ko ? "비정기" : "Irregular" : ko ? "미확인" : "Unconfirmed"}</span>
      {creator.latestObservation && <time dateTime={creator.latestObservation.observedAt}>{new Intl.DateTimeFormat(ko ? "ko-KR" : "en-US", { timeZone: "Asia/Seoul", dateStyle: "medium" }).format(new Date(creator.latestObservation.observedAt))}</time>}
    </li>)}</ul>
    <h3>{ko ? `검토 대기 ${data.reviews.length}건` : `${data.reviews.length} pending reviews`}</h3>
    {data.reviews.map(item => <article className={styles.review} key={item.id} aria-busy={pending === item.id}>
      <h4>{item.celebrityName} · {({ initial: ko ? "첫 정기 규칙" : "Initial rule", rule_change: ko ? "일정 변경" : "Schedule change", hiatus: ko ? "휴방 확인" : "Broadcast pause", source_conflict: ko ? "출처 확인 필요" : "Conflicting sources", duplicate: ko ? "중복 확인 필요" : "Possible duplicate" } as Record<string, string>)[item.reason] ?? item.reason}</h4>
      <div className={styles.comparison}><div><strong>{ko ? "현재 규칙" : "Current rule"}</strong><RuleSummary value={item.currentRule} ko={ko} /></div><div><strong>{ko ? "제안 규칙" : "Proposed rule"}</strong><RuleSummary value={item.rule} ko={ko} /></div></div>
      {item.observations.map((source, index) => <blockquote key={index}><p>{source.originalText}</p>{source.sourceUrl && /^https:\/\/(?:www\.)?(?:tiktok\.com|instagram\.com|youtube\.com|youtu\.be|chzzk\.naver\.com)\//.test(source.sourceUrl) && <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">{ko ? "공식 출처" : "Official source"}</a>} <time dateTime={source.observedAt}>{source.observedAt}</time></blockquote>)}
      {role !== "viewer" && <div className={styles.actions}>{["initial","rule_change"].includes(item.reason) && <button type="button" disabled={pending !== null} onClick={() => void resolve(item, {action:"approve_rule"})}>{ko ? "규칙 승인" : "Approve rule"}</button>}<label>{ko ? "처리 사유 (거절·취소)" : "Reason for rejection or cancellation"}<input value={reasons[item.id] ?? ""} onChange={event => setReasons(current => ({ ...current, [item.id]: event.target.value }))} maxLength={1000} /></label><button type="button" disabled={pending !== null || !reasons[item.id]?.trim()} onClick={() => void resolve(item, {action:"reject",reason:reasons[item.id]?.trim() ?? ""})}>{ko ? "거절" : "Reject"}</button></div>}
    {role !== "viewer" && item.reason === "hiatus" && <button type="button" disabled={pending !== null || !reasons[item.id]?.trim()} onClick={() => void resolve(item, { action: "cancel_occurrences", eventIds: [], reason: reasons[item.id]?.trim() ?? "" })}>{ko ? "추가 일정 생성 중단" : "Pause future schedule generation"}</button>}
    {role !== "viewer" && item.reviewPayload?.candidateEventIds && <fieldset disabled={pending !== null} className={styles.candidates}>
        <legend>{ko ? "관련 LIVE" : "Related LIVE events"}</legend>
        {item.reviewPayload.candidateEventIds.map(id => {
          const candidate = item.reviewPayload?.candidateEvents?.find(event => event.id === id);
          return <div key={id}><label>{item.reason !== "duplicate" && <input type="checkbox" checked={(selectedEvents[item.id] ?? []).includes(id)} onChange={event => setSelectedEvents(current => ({...current,[item.id]:event.target.checked ? [...(current[item.id] ?? []),id] : (current[item.id] ?? []).filter(value=>value!==id)}))}/>} {candidate ? `${candidate.title} · ${candidate.startsAt} · ${ko ? "예약" : "Reservations"} ${candidate.reservationCount}` : id}</label>{candidate && <a href={`/live/${candidate.slug}?locale=${locale}`} target="_blank" rel="noopener noreferrer">{ko ? "LIVE 보기" : "View LIVE"}</a>}{item.reason === "duplicate" && <button type="button" onClick={()=>void resolve(item,{action:"link_existing",eventId:id})}>{ko ? "이 LIVE에 연결" : "Link this LIVE"}</button>}</div>;
        })}
        {item.reason === "duplicate" && <button type="button" onClick={()=>void resolve(item,{action:"distinct_events"})}>{ko ? "서로 다른 방송으로 확인" : "Confirm separate broadcasts"}</button>}
        {item.reason !== "duplicate" && <button type="button" disabled={!(selectedEvents[item.id]?.length) || !reasons[item.id]?.trim()} onClick={()=>void resolve(item,{action:"cancel_occurrences",eventIds:selectedEvents[item.id] ?? [],reason:reasons[item.id]?.trim() ?? ""})}>{ko ? "선택한 LIVE 취소" : "Cancel selected LIVE events"}</button>}
      </fieldset>}
    </article>)}</>}
  </section>;
}
