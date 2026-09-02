"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthIntentLink } from "../../../components/auth-intent-link";
import { consumeAuthIntent, readAuthIntent } from "../../../components/auth-intent";
import { reactionResultSchema, type ReactionResult } from "../domain/reaction";
import styles from "./reaction-action.module.css";

const copy = {
  ko: { title: "첫 반응 남기기", body: "이 Creator를 향한 첫 마음을 온체인에 한 번 기록해요.", action: "첫 Reaction 남기기", working: "기록하는 중…", done: "첫 Reaction을 남겼어요", error: "Reaction을 기록하지 못했어요. 잠시 후 다시 시도해 주세요.", modalTitle: "Reaction이 기록됐어요", modalBody: "Fan Passport를 만들면 방금 남긴 반응을 나의 팬 활동 기록에서 확인할 수 있어요.", passport: "Fan Passport 만들기", later: "나중에 할게요" },
  en: { title: "Leave your first reaction", body: "Record your first moment for this Creator on-chain—once and forever.", action: "Leave First Reaction", working: "Recording…", done: "First Reaction recorded", error: "We couldn't record your Reaction. Try again in a moment.", modalTitle: "Reaction recorded", modalBody: "Create a Fan Passport to see this Reaction in your fan activity history.", passport: "Create Fan Passport", later: "Maybe later" },
} as const;

export function ReactionAction({ slug, locale }: { slug: string; locale: "ko" | "en" }) {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [result, setResult] = useState<ReactionResult | null>(null);
  const resumed = useRef(false);
  const t = copy[locale];

  const react = useCallback(async () => {
    if (!ready || !authenticated || state === "working" || state === "done") return;
    setState("working");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing token");
      const response = await fetch(`/api/celebrities/${encodeURIComponent(slug)}/reactions`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.code ?? "reaction failed");
      const parsed = reactionResultSchema.parse(body);
      setResult(parsed);
      setState("done");
    } catch { setState("error"); }
  }, [authenticated, getAccessToken, ready, slug, state]);

  useEffect(() => {
    if (!authenticated || resumed.current) return;
    const id = new URLSearchParams(window.location.search).get("authIntent");
    const intent = readAuthIntent(window.sessionStorage, id);
    if (intent?.actionType !== "CREATE_REACTION" || intent.targetId !== slug) return;
    resumed.current = true;
    consumeAuthIntent(window.sessionStorage, intent.id);
    void react();
  }, [authenticated, react, slug]);

  const verificationHref = result ? `/c/${slug}/verify?locale=${locale}&source=reaction&reactionId=${result.reactionId}` : `/c/${slug}/verify?locale=${locale}`;
  return <section className={styles.card} id="first-reaction" aria-labelledby="first-reaction-title">
    <div><p>FIRST REACTION</p><h2 id="first-reaction-title">{t.title}</h2><span>{t.body}</span></div>
    {!ready ? <button disabled>{t.working}</button>
      : !authenticated ? <AuthIntentLink focusKey="first-reaction" locale={locale} input={{ sourcePath: `/c/${slug}`, sourceQuery: `?locale=${locale}`, actionType: "CREATE_REACTION", targetType: "celebrity", targetId: slug, returnAnchor: "#first-reaction" }}>{t.action}</AuthIntentLink>
      : <button type="button" onClick={() => void react()} disabled={state === "working" || state === "done"}>{state === "working" ? t.working : state === "done" ? t.done : t.action}</button>}
    {state === "error" && <p role="alert" className={styles.error}>{t.error}</p>}
    {state === "done" && result && !result.passportExists && <div className={styles.backdrop} role="presentation"><div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="reaction-modal-title"><h2 id="reaction-modal-title">{t.modalTitle}</h2><p>{t.modalBody}</p><Link href={verificationHref}>{t.passport}</Link><button type="button" onClick={() => setResult({ ...result, passportExists: true })}>{t.later}</button></div></div>}
  </section>;
}
