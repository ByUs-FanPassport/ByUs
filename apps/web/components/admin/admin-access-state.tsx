"use client";

import { AlertCircle, LoaderCircle, ShieldAlert } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import styles from "./operations.module.css";

export function AdminAccessState({ status, locale }: { status: "loading" | "unauthenticated" | "denied"; locale: "ko" | "en" }) {
  const ko = locale === "ko";
  const content = status === "loading"
    ? { icon: <LoaderCircle className={styles.spin} aria-hidden="true" />, title: ko ? "관리자 권한 확인 중" : "Checking admin access", body: ko ? "안전한 운영 세션을 확인하고 있습니다." : "We are verifying your secure operations session." }
    : status === "unauthenticated"
      ? { icon: <ShieldAlert aria-hidden="true" />, title: ko ? "관리자 로그인이 필요합니다" : "Admin sign-in required", body: ko ? "운영 데이터는 권한이 확인된 관리자에게만 표시됩니다." : "Operations data is available only to verified administrators." }
      : { icon: <AlertCircle aria-hidden="true" />, title: ko ? "접근 권한을 확인할 수 없습니다" : "Access could not be verified", body: ko ? "활성 관리자 권한을 확인한 뒤 다시 시도해 주세요." : "Confirm your active admin access and try again." };
  return <main className={styles.accessPage}><section className={styles.accessPanel} aria-live="polite">{content.icon}<h1>{content.title}</h1><p>{content.body}</p>{status !== "loading" && <Link className={styles.primaryLink} href={(locale === "en" ? "/admin/login?lang=en" : "/admin/login") as Route}>{ko ? "관리자 로그인" : "Admin sign in"}</Link>}</section></main>;
}

