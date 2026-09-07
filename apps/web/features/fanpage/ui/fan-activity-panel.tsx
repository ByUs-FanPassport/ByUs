"use client";
import { usePrivy } from "@privy-io/react-auth";
import { useState } from "react";
import { z } from "zod";
import { fanpageSummarySchema } from "../domain/community";
import { useOwnedFanResource } from "@/components/fan-ui/use-owned-fan-resource";
import { useFanpageResource } from "./use-fanpage-resource";
import styles from "./fanpage.module.css";
const parse = (value: unknown) => fanpageSummarySchema.parse(value);
const parseVisibility = (value: unknown) => z.object({ enabled: z.boolean() }).strict().parse(value);
export function FanActivityPanel({ slug, locale }: { slug: string; locale: "ko" | "en" }) {
  const auth = usePrivy();
  const resource = useFanpageResource(`/api/celebrities/${slug}/fanpage`, parse);
  const visibility = useOwnedFanResource("/api/me/fan-activity-visibility", parseVisibility, auth);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ko = locale === "ko";
  async function toggle(enabled: boolean) {
    setBusy(true); setFailed(false);
    try {
      const token = await auth.getAccessToken();
      if (!token) throw new Error();
      const response = await fetch("/api/me/fan-activity-visibility", { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ enabled }) });
      if (!response.ok) throw new Error();
      visibility.retry(); resource.retry();
    } catch { setFailed(true); }
    finally { setBusy(false); }
  }
  return <section className={styles.activity}><h2>{ko ? "함께하는 팬들" : "Fans together"}</h2>{resource.state.status === "ready" ? resource.state.data.activity.length ? <ul>{resource.state.data.activity.map((event, index) => <li key={`${event.occurredAt}:${index}`}><img src={event.avatarUrl} width={32} height={32} alt="" /><p><strong>{event.nickname}</strong>{ko ? (event.kind === "joined" ? "님이 팬 여정을 시작했어요." : event.kind === "level_up" ? "님이 새로운 팬 등급에 올랐어요." : "님이 첫 인증을 마쳤어요.") : (event.kind === "joined" ? " started their fan journey." : event.kind === "level_up" ? " reached a new fan tier." : " completed their first verification.")}</p></li>)}</ul> : <p className={styles.muted}>{ko ? "새로운 팬 활동을 기다리고 있어요." : "Waiting for new fan moments."}</p> : <p className={styles.muted}>{ko ? (resource.state.status === "error" ? "팬 활동을 불러오지 못했어요." : "팬 활동을 확인하고 있어요.") : "Checking fan activity."}</p>}
    {auth.authenticated && visibility.state.status === "ready" && <label className={styles.visibility}><input type="checkbox" checked={visibility.state.data.enabled} disabled={busy} onChange={(event) => void toggle(event.target.checked)} /><span>{ko ? "내 입덕·승급·첫 인증 활동 공개" : "Share my joins, tier changes and first verifications"}<small>{ko ? "모든 팬페이지에 닉네임과 캐릭터가 표시돼요. 증빙은 공개되지 않아요." : "Your nickname and character appear on fan pages. Evidence stays private."}</small></span></label>}
    {failed && <p role="alert">{ko ? "설정을 저장하지 못했어요." : "Couldn't save your setting."}</p>}
  </section>;
}
