"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Check, Copy, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { communityShareLinkSchema } from "../domain/community-stamps";
import { communityStampAction } from "./use-community-stamps";
import styles from "./share-passport.module.css";

type Locale = "ko" | "en";
type Creator = { slug: string; name?: string; image?: { url: string; alt: string } };

function copyFor(locale: Locale) {
  return locale === "ko"
    ? { create: "공유 링크 만들기", share: "공유", copy: "복사", ready: "링크가 준비됐어요. 공유하거나 복사해 보내세요.", copied: "링크를 복사했어요.", fallback: "링크를 선택해서 복사해 주세요.", unavailable: "발급된 패스포트가 있어야 공유할 수 있어요.", failed: "공유 링크를 준비하지 못했어요. 다시 시도해 주세요." }
    : { create: "Create share link", share: "Share", copy: "Copy", ready: "Your link is ready. Share or copy it to send.", copied: "Link copied.", fallback: "Select the link and copy it.", unavailable: "An issued Passport is needed before sharing.", failed: "We couldn't prepare a share link. Please try again." };
}

export function SharePassport({ creator, locale }: { creator: Creator; locale: Locale }) {
  const auth = usePrivy();
  return <SharePassportInner key={`${auth.user?.id ?? "guest"}:${creator.slug}:${locale}`} creator={creator} locale={locale} getAccessToken={auth.getAccessToken} />;
}

function SharePassportInner({ creator, locale, getAccessToken }: { creator: Creator; locale: Locale; getAccessToken: () => Promise<string | null> }) {
  const c = copyFor(locale);
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function createLink() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setFailed(false); setMessage("");
    try {
      const result = await communityStampAction(getAccessToken, "share-link", { creator: creator.slug }, (value) => communityShareLinkSchema.parse(value));
      if (alive.current) { setUrl(`${window.location.origin}/s/${result.token}?locale=${locale}`); setMessage(c.ready); }
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (alive.current) { setFailed(true); setMessage(code === "COMMUNITY_STAMP_PASSPORT_REQUIRED" ? c.unavailable : c.failed); }
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function copyLink() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); if (alive.current) { setFailed(false); setMessage(c.copied); } }
    catch { if (alive.current) { setFailed(true); setMessage(c.fallback); } }
  }

  async function nativeShare() {
    if (!url || !navigator.share) return;
    try { await navigator.share({ title: `${creator.name ?? creator.slug} Fan Passport`, url }); }
    catch (error) { if (!(error instanceof DOMException && error.name === "AbortError") && alive.current) { setFailed(true); setMessage(c.fallback); } }
  }

  return <div className={styles.sender}>
    {!url ? <button className={styles.primary} type="button" onClick={() => void createLink()} disabled={busy}><Share2 aria-hidden="true" />{c.create}</button> : <>
      <label className={styles.shareUrlLabel}><span className={styles.srOnly}>{locale === "ko" ? "공유 링크" : "Share link"}</span><input className={styles.shareUrl} value={url} readOnly onFocus={(event) => event.currentTarget.select()} aria-describedby="share-link-message" /></label>
      <div className={styles.shareActions}>{typeof navigator !== "undefined" && typeof navigator.share === "function" && <button className={styles.primary} type="button" onClick={() => void nativeShare()}><Share2 aria-hidden="true" />{c.share}</button>}<button className={styles.secondaryButton} type="button" onClick={() => void copyLink()}><Copy aria-hidden="true" />{c.copy}</button></div>
    </>}
    {message && <p id="share-link-message" className={failed ? styles.error : styles.status} role={failed ? "alert" : "status"}>{!failed && url && message === c.ready ? <><Check aria-hidden="true" />{message}</> : message}</p>}
  </div>;
}
