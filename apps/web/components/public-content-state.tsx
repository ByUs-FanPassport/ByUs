"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./public-content-state.module.css";

type PublicContentStateProps =
  | Readonly<{ state: "loading"; scope: "home" | "directory" | "celebrity" }>
  | Readonly<{ state: "error"; scope: "home" | "directory" | "celebrity"; retry: () => void }>;

const labels = {
  ko: {
    loading: { home: "오늘의 공개 콘텐츠를 불러오고 있어요.", directory: "공개 셀럽 목록을 불러오고 있어요.", celebrity: "공개 팬페이지를 불러오고 있어요." },
    error: { home: "홈 콘텐츠를 불러오지 못했어요.", directory: "공개 셀럽 목록을 불러오지 못했어요.", celebrity: "팬페이지를 불러오지 못했어요." },
    help: "연결 상태를 확인한 뒤 다시 시도해 주세요.", retry: "다시 시도", home: "홈으로",
  },
  en: {
    loading: { home: "Loading today's published content.", directory: "Loading published celebrities.", celebrity: "Loading the published fan page." },
    error: { home: "We couldn't load the home content.", directory: "We couldn't load the published celebrities.", celebrity: "We couldn't load this fan page." },
    help: "Check your connection and try again.", retry: "Try again", home: "Go home",
  },
} as const;

export function PublicContentState(props: PublicContentStateProps) {
  const [locale, setLocale] = useState<"ko" | "en">("ko");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("locale") === "en") setLocale("en");
  }, []);
  const t = labels[locale];
  return <main className={styles.page} aria-live="polite" aria-busy={props.state === "loading"}>
    <div className={styles.state} role={props.state === "error" ? "alert" : "status"}>
      <span className={styles.wordmark}>ByUs</span>
      <h1>{props.state === "loading" ? t.loading[props.scope] : t.error[props.scope]}</h1>
      {props.state === "loading" ? <div className={styles.progress} aria-hidden="true" /> : <><p>{t.help}</p><div className={styles.actions}><button type="button" onClick={props.retry}>{t.retry}</button><Link href={`/?locale=${locale}`}>{t.home}</Link></div></>}
    </div>
  </main>;
}
