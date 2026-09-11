"use client";
import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { fanpageSummarySchema } from "../domain/community";
import { useOwnedFanResource } from "@/components/fan-ui/use-owned-fan-resource";
import { useFanpageResource } from "./use-fanpage-resource";
import styles from "./fanpage.module.css";
const parse = (value: unknown) => fanpageSummarySchema.parse(value);
const parseVisibility = (value: unknown) => z.object({ enabled: z.boolean() }).strict().parse(value);
export function FanActivityPanel({ slug, locale }: { slug: string; locale: "ko" | "en" }) {
  const auth = usePrivy();
  return <FanActivityContent key={`${auth.ready}:${auth.authenticated}:${auth.user?.id ?? "guest"}:${slug}`} slug={slug} locale={locale} auth={auth} />;
}
function FanActivityContent({ slug, locale, auth }: { slug: string; locale: "ko" | "en"; auth: ReturnType<typeof usePrivy> }) {
  const resource = useFanpageResource(`/api/celebrities/${slug}/fanpage?locale=${locale}`, parse, true);
  const visibility = useOwnedFanResource("/api/me/fan-activity-visibility", parseVisibility, auth);
  const [optimistic, setOptimistic] = useState<boolean>();
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const active = useRef(true);
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; inFlight.current?.abort(); };
  }, []);
  const busy = optimistic !== undefined;
  const ko = locale === "ko";
  async function toggle(enabled: boolean) {
    if (inFlight.current || visibility.state.status !== "ready") return;
    const controller = new AbortController();
    inFlight.current = controller;
    setOptimistic(enabled); setFailed(false); setSaved(false);
    try {
      const token = await auth.getAccessToken();
      if (!active.current || controller.signal.aborted) return;
      if (!token) throw new Error();
      const response = await fetch("/api/me/fan-activity-visibility", { method: "PATCH", signal: controller.signal, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ enabled }) });
      if (!response.ok) throw new Error();
      const next = parseVisibility(await response.json());
      if (!active.current || controller.signal.aborted) return;
      visibility.replaceData(next); setSaved(true); resource.retry();
    } catch { if (active.current && !controller.signal.aborted) setFailed(true); }
    finally { if (active.current && !controller.signal.aborted) { inFlight.current = null; setOptimistic(undefined); } }
  }
  return <section className={styles.activity}><h2>{ko ? "함께하는 팬들" : "Fan community"}</h2>{resource.state.status === "ready" ? resource.state.data.activity.length ? <ul>{resource.state.data.activity.map((event, index) => <li key={`${event.occurredAt}:${index}`}><img src={event.avatarUrl} width={32} height={32} alt="" /><p><strong>{event.nickname}</strong>{ko ? (event.kind === "joined" ? "님이 팬 여정을 시작했어요." : event.kind === "level_up" ? "님이 새로운 팬 등급에 올랐어요." : "님이 첫 인증을 마쳤어요.") : (event.kind === "joined" ? " started their fan journey." : event.kind === "level_up" ? " reached a new fan tier." : " completed their first verification.")}</p></li>)}</ul> : <p className={styles.muted}>{ko ? "새로운 팬 활동을 기다리고 있어요." : "Waiting for new fan activity."}</p> : <p className={styles.muted}>{ko ? (resource.state.status === "error" ? "팬 활동을 불러오지 못했어요." : "팬 활동을 확인하고 있어요.") : "Checking fan activity."}</p>}
    {auth.authenticated && visibility.state.status === "ready" && <label className={styles.visibility} aria-busy={busy}><input type="checkbox" checked={optimistic ?? visibility.state.data.enabled} disabled={busy} onChange={(event) => void toggle(event.target.checked)} /><span>{ko ? "내 입덕·승급·첫 인증 활동 공개" : "Share when I start my fan journey, reach a new tier, or complete my first verification"}<small>{ko ? "모든 팬페이지에 닉네임과 캐릭터가 표시돼요. 증빙은 공개되지 않아요." : "Your nickname and character appear on fan pages. Evidence stays private."}</small></span></label>}
    {(busy || saved) && <p className={styles.visibilityStatus} role="status">{busy ? (ko ? "저장 중…" : "Saving…") : (ko ? "설정을 저장했어요." : "Setting saved.")}</p>}
    {resource.refreshFailed && <p className={styles.muted}>{ko ? "팬 활동을 갱신하지 못했어요." : "Couldn't refresh fan activity."} <button onClick={resource.retry}>{ko ? "다시 시도" : "Try again"}</button></p>}
    {failed && <p role="alert">{ko ? "설정을 저장하지 못했어요." : "Couldn't save your setting."}</p>}
  </section>;
}
