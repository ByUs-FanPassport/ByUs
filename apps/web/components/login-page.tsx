"use client";

import { useLogin, usePrivy } from "@privy-io/react-auth";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, GoogleMark } from "./icons";
import { appendLoginContext, sanitizeEntity, sanitizeIntent, sanitizeLocale, sanitizeReturnTo } from "./login-intent";
import styles from "./login-page.module.css";

export function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [error, setError] = useState<string | null>(null);
  const synchronizationRef = useRef<Promise<void> | null>(null);
  const returnTo = useMemo(() => sanitizeReturnTo(searchParams.get("returnTo")), [searchParams]);
  const intent = useMemo(() => sanitizeIntent(searchParams.get("intent")), [searchParams]);
  const entity = useMemo(() => sanitizeEntity(searchParams.get("entity")), [searchParams]);
  const locale = useMemo(() => sanitizeLocale(searchParams.get("locale")), [searchParams]);
  const synchronizeSession = useCallback(() => {
    if (synchronizationRef.current) return synchronizationRef.current;

    synchronizationRef.current = (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Missing Privy access token");
        const response = await fetch("/api/auth/session", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Session synchronization failed");
        const body = await response.json() as { profile?: { completed?: boolean } };
        const destination = body.profile?.completed
          ? returnTo
          : appendLoginContext("/onboarding/profile", { returnTo, intent, entity, locale });
        router.replace(destination as Route);
      } catch {
        synchronizationRef.current = null;
        setError("로그인 정보를 안전하게 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
    })();

    return synchronizationRef.current;
  }, [entity, getAccessToken, intent, locale, returnTo, router]);
  const { login } = useLogin({
    onComplete: synchronizeSession,
    onError: () => setError("로그인을 완료하지 못했어요. Google 계정을 확인한 뒤 다시 시도해 주세요."),
  });

  useEffect(() => {
    if (ready && authenticated) void synchronizeSession();
  }, [authenticated, ready, synchronizeSession]);

  const context = intent === "reserve"
    ? "로그인 후 선택한 라이브 예약 화면으로 돌아갑니다."
    : intent === "passport"
      ? "로그인 후 Fan Passport 발급을 이어갑니다."
      : "로그인 후 보고 있던 화면으로 돌아갑니다.";

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="login-heading">
        <Link className={styles.brand} href="/" aria-label="ByUs 홈으로 돌아가기"><Image src="/images/guest-home/byus-wordmark.svg" alt="ByUs" width={96} height={36} priority /></Link>
        <div className={styles.copy}>
          <h1 id="login-heading">최애와 함께한 순간을 기록하세요.</h1>
          <p>Google 계정 하나로 로그인하고, 나만의 Embedded Wallet과 Fan Passport를 안전하게 이어갈 수 있어요.</p>
        </div>
        <button className={styles.googleButton} type="button" disabled={!ready || authenticated} onClick={() => { setError(null); login({ loginMethods: ["google"] }); }}>
          <GoogleMark /><span>{ready ? "Google로 계속하기" : "로그인 준비 중"}</span><ArrowRight />
        </button>
        <p className={styles.context}>{context}</p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <Link className={styles.backLink} href="/">홈으로 돌아가기</Link>
      </section>
    </main>
  );
}
