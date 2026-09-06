"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthIntentLink } from "../../../components/auth-intent-link";
import { consumeAuthIntent, readAuthIntent } from "../../../components/auth-intent";
import { notifyFanActivityUpdated, subscribeFanActivityUpdates } from "../../../components/fan-ui/fan-activity-updates";
import { ArrowRight, Heart } from "../../../components/icons";
import { reactionResultSchema, type ReactionResult } from "../domain/reaction";
import styles from "./reaction-action.module.css";

const copy = {
  ko: { title: "좋아요 남기기", body: "좋아하는 마음을 팬 활동 기록에 남겨보세요.", action: "좋아요 남기기", working: "남기는 중…", checking: "확인하는 중…", done: "좋아요를 남겼어요", error: "좋아요를 남기지 못했어요. 잠시 후 다시 시도해 주세요.", statusError: "좋아요 기록을 확인하지 못했어요. 다시 시도해 주세요.", retry: "다시 확인", modalTitle: "좋아요를 남겼어요", modalBody: "Fan Passport를 만들면 방금 남긴 좋아요를 팬 활동 기록에서 확인할 수 있어요.", passport: "Fan Passport 만들기", later: "나중에 할게요" },
  en: { title: "Leave your first reaction", body: "Record your first moment for this Creator on-chain—once and forever.", action: "Leave First Reaction", working: "Recording…", checking: "Checking…", done: "First Reaction recorded", error: "We couldn't record your Reaction. Try again in a moment.", statusError: "We couldn't check your Reaction record. Try again in a moment.", retry: "Check again", modalTitle: "Reaction recorded", modalBody: "Create a Fan Passport to see this Reaction in your fan activity history.", passport: "Create Fan Passport", later: "Maybe later" },
} as const;

type CheckState = "checking" | "ready" | "error";
type ActionState = "idle" | "working" | "done" | "error";

/**
 * Each Privy owner and creator gets a separate stateful instance. This prevents
 * a completed CTA or an in-flight response from a prior account being reused.
 */
export function ReactionAction({ slug, locale }: { slug: string; locale: "ko" | "en" }) {
  const { ready, authenticated, getAccessToken, user } = usePrivy();
  const ownerId = user?.id;
  return <ReactionActionForOwner key={`${ready ? "ready" : "loading"}:${authenticated ? "authenticated" : "guest"}:${ownerId ?? "unknown"}:${slug}`} slug={slug} locale={locale} ready={ready} authenticated={authenticated} ownerId={ownerId} getAccessToken={getAccessToken} />;
}

function ReactionActionForOwner({ slug, locale, ready, authenticated, ownerId, getAccessToken }: {
  slug: string;
  locale: "ko" | "en";
  ready: boolean;
  authenticated: boolean;
  ownerId: string | undefined;
  getAccessToken: () => Promise<string | null>;
}) {
  const [checkState, setCheckState] = useState<CheckState>(authenticated ? "checking" : "ready");
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [result, setResult] = useState<ReactionResult | null>(null);
  const [showModal, setShowModal] = useState(false);
  const checkStateRef = useRef(checkState);
  const postInFlight = useRef<Promise<void> | null>(null);
  const readAbort = useRef<AbortController | null>(null);
  const postAbort = useRef<AbortController | null>(null);
  const resumedIntent = useRef<string | null>(null);
  const knownReaction = useRef(false);
  const active = useRef(true);
  const t = copy[locale];

  useEffect(() => {
    checkStateRef.current = checkState;
  }, [checkState]);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      readAbort.current?.abort();
      postAbort.current?.abort();
    };
  }, []);

  const postReaction = useCallback(async (fromVerifiedAuthIntent = false) => {
    if (!ready || !authenticated || postInFlight.current || !active.current) return;
    if (!fromVerifiedAuthIntent && (checkStateRef.current !== "ready" || knownReaction.current)) return;
    const controller = new AbortController();
    postAbort.current = controller;
    const operation = (async () => {
      setActionState("working");
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("missing token");
        if (controller.signal.aborted || !active.current) return;
        const response = await fetch(`/api/celebrities/${encodeURIComponent(slug)}/reactions`, {
          method: "POST", headers: { authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store",
        });
        const body = await response.json();
        if (controller.signal.aborted || !active.current) return;
        if (!response.ok) throw new Error(body?.error?.code ?? "reaction failed");
        const parsed = reactionResultSchema.parse(body);
        knownReaction.current = true;
        setResult(parsed);
        setActionState("done");
        setShowModal(!parsed.passportExists);
        notifyFanActivityUpdated(ownerId);
      } catch {
        if (!controller.signal.aborted && active.current) setActionState("error");
      } finally {
        if (postAbort.current === controller) postAbort.current = null;
        postInFlight.current = null;
      }
    })();
    postInFlight.current = operation;
    await operation;
  }, [authenticated, getAccessToken, ownerId, ready, slug]);

  const resumeIntentIfNeeded = useCallback(() => {
    const id = new URLSearchParams(window.location.search).get("authIntent");
    if (!id || resumedIntent.current === id) return;
    const intent = readAuthIntent(window.sessionStorage, id);
    if (intent?.actionType !== "CREATE_REACTION" || intent.targetId !== slug) return;
    resumedIntent.current = id;
    consumeAuthIntent(window.sessionStorage, intent.id);
    void postReaction(true);
  }, [postReaction, slug]);

  const readExisting = useCallback(async () => {
    if (!ready || !authenticated) return;
    readAbort.current?.abort();
    const controller = new AbortController();
    readAbort.current = controller;
    setCheckState("checking");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing token");
      if (controller.signal.aborted || !active.current) return;
      const response = await fetch(`/api/celebrities/${encodeURIComponent(slug)}/reactions`, {
        headers: { authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store",
      });
      if (!response.ok) throw new Error("reaction lookup failed");
      const body = await response.json();
      if (controller.signal.aborted || !active.current) return;
      if (body?.reaction === null) {
        // A reaction is append-only. Do not let a briefly stale read after our
        // successful POST reopen its CTA while the database projection catches up.
        if (!knownReaction.current) {
          setResult(null);
          setActionState("idle");
          resumeIntentIfNeeded();
        }
      } else {
        const parsed = reactionResultSchema.safeParse(body?.reaction);
        if (!parsed.success) throw new Error("reaction lookup invalid");
        knownReaction.current = true;
        setResult(parsed.data);
        setActionState("done");
      }
      setCheckState("ready");
    } catch (error) {
      if (!controller.signal.aborted && active.current && (error as DOMException).name !== "AbortError") setCheckState("error");
    } finally {
      if (readAbort.current === controller) readAbort.current = null;
    }
  }, [authenticated, getAccessToken, ready, resumeIntentIfNeeded, slug]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    void readExisting();
    return () => readAbort.current?.abort();
  }, [authenticated, readExisting, ready]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    return subscribeFanActivityUpdates(ownerId, () => { void readExisting(); });
  }, [authenticated, ownerId, readExisting, ready]);

  const verificationHref = result ? `/c/${slug}/verify?locale=${locale}&source=reaction&reactionId=${result.reactionId}` : `/c/${slug}/verify?locale=${locale}`;
  const checking = authenticated && checkState === "checking";
  return <section className={styles.card} id="first-reaction" aria-labelledby="first-reaction-title">
    <span className={styles.icon} aria-hidden="true"><Heart /></span>
    <div className={styles.copy}><h2 id="first-reaction-title">{t.title}</h2><span>{t.body}</span></div>
    {!ready ? <button disabled><Heart />{t.working}</button>
      : !authenticated ? <AuthIntentLink focusKey="first-reaction" locale={locale} input={{ sourcePath: `/c/${slug}`, sourceQuery: `?locale=${locale}`, actionType: "CREATE_REACTION", targetType: "celebrity", targetId: slug, returnAnchor: "#first-reaction" }}><Heart />{t.action}<ArrowRight /></AuthIntentLink>
      : checkState === "error" ? <button type="button" onClick={() => void readExisting()}><Heart />{t.retry}<ArrowRight /></button>
      : <button type="button" onClick={() => void postReaction()} disabled={checking || actionState === "working" || actionState === "done"}><Heart />{checking ? t.checking : actionState === "working" ? t.working : actionState === "done" ? t.done : t.action}<ArrowRight /></button>}
    {checkState === "error" ? <p role="alert" className={styles.error}>{t.statusError}</p> : null}
    {actionState === "error" && checkState !== "error" ? <p role="alert" className={styles.error}>{t.error}</p> : null}
    {actionState === "done" && result && showModal && <div className={styles.backdrop} role="presentation"><div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="reaction-modal-title"><h2 id="reaction-modal-title">{t.modalTitle}</h2><p>{t.modalBody}</p><Link href={verificationHref as Route}>{t.passport}</Link><button type="button" onClick={() => setShowModal(false)}>{t.later}</button></div></div>}
  </section>;
}
