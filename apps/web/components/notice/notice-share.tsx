"use client";
import { useState } from "react";
import { Share2 } from "lucide-react";
import styles from "./notice-detail.module.css";

export function NoticeShare({ title, locale }: { title: string; locale: "ko" | "en" }) {
  const [message, setMessage] = useState("");
  async function share() {
    try {
      if (navigator.share) await navigator.share({ title, url: location.href });
      else {
        await navigator.clipboard.writeText(location.href);
        setMessage(locale === "ko" ? "링크를 복사했어요." : "Link copied.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(locale === "ko" ? "링크를 복사하지 못했어요." : "Could not copy the link.");
    }
  }
  return <><button className={styles.share} type="button" onClick={share} aria-label={locale === "ko" ? `공유: ${title}` : `Share: ${title}`}><Share2 aria-hidden="true" />{locale === "ko" ? "공유" : "Share"}</button><span className={styles.srOnly} aria-live="polite">{message}</span></>;
}
