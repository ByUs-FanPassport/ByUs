"use client";

import { useLogin, usePrivy } from "@privy-io/react-auth";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { ArrowRight, GoogleMark } from "./icons";
import { appendLoginContext, sanitizeAuthIntentId, sanitizeEntity, sanitizeIntent, sanitizeLocale, sanitizeReturnTo } from "./login-intent";
import { BottomSheet, Dialog } from "./ui/overlay/accessible-overlay";
import styles from "./login-page.module.css";

type LoginPageProps = {
  presentation?: "standalone" | "overlay";
  testAccountLoginEnabled?: boolean;
};

function useMobileLoginPresentation() {
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 47.999rem)");
    const synchronize = () => setMobile(media.matches);
    synchronize();
    media.addEventListener("change", synchronize);
    return () => media.removeEventListener("change", synchronize);
  }, []);

  return mobile;
}

export function LoginPage({
  presentation = "standalone",
  testAccountLoginEnabled = false,
}: LoginPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [error, setError] = useState<string | null>(null);
  const synchronizationRef = useRef<Promise<void> | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const mobilePresentation = useMobileLoginPresentation();
  const returnTo = useMemo(() => sanitizeReturnTo(searchParams.get("returnTo")), [searchParams]);
  const intent = useMemo(() => sanitizeIntent(searchParams.get("intent")), [searchParams]);
  const entity = useMemo(() => sanitizeEntity(searchParams.get("entity")), [searchParams]);
  const authIntent = useMemo(() => sanitizeAuthIntentId(searchParams.get("authIntent")), [searchParams]);
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
          : appendLoginContext("/onboarding/profile", { returnTo, intent, entity, locale, authIntent });
        router.replace(destination as Route);
      } catch {
        synchronizationRef.current = null;
        setError("로그인 정보를 안전하게 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
    })();

    return synchronizationRef.current;
  }, [authIntent, entity, getAccessToken, intent, locale, returnTo, router]);
  const { login } = useLogin({
    onComplete: synchronizeSession,
    onError: () => setError(
      testAccountLoginEnabled
        ? "로그인을 완료하지 못했어요. 계정 정보와 인증 코드를 확인한 뒤 다시 시도해 주세요."
        : "로그인을 완료하지 못했어요. Google 계정을 확인한 뒤 다시 시도해 주세요.",
    ),
  });

  useEffect(() => {
    if (ready && authenticated) void synchronizeSession();
  }, [authenticated, ready, synchronizeSession]);

  const context = intent === "reserve"
    ? "로그인 후 선택한 라이브 예약 화면으로 돌아갑니다."
    : intent === "attendance"
      ? "로그인 후 입력한 Fan Code 출석 인증을 이어갑니다."
      : intent === "survey"
        ? "로그인 후 참여 가능한 LIVE 후기 화면으로 돌아갑니다."
        : intent === "benefit-claim" || intent === "benefit-application"
          ? "로그인 후 선택한 혜택의 수령 과정을 이어갑니다."
    : intent === "passport"
      ? "로그인 후 Fan Passport 발급을 이어갑니다."
      : "로그인 후 보고 있던 화면으로 돌아갑니다.";

  const content = (
    <>
        <div className={styles.panelHeader}>
          <Link className={styles.brand} href="/" aria-label="ByUs 홈으로 돌아가기"><Image src="/images/guest-home/byus-wordmark.svg" alt="ByUs" width={96} height={36} priority /></Link>
          {presentation === "overlay" && (
            <button
              ref={closeButtonRef}
              className={styles.closeButton}
              type="button"
              aria-label="로그인 창 닫기"
              onClick={() => router.back()}
            >
              <X aria-hidden="true" />
            </button>
          )}
        </div>
        <div className={styles.copy}>
          <h1 id="login-heading">최애와 함께한 순간을 기록하세요.</h1>
          <p id="login-description">Google 계정 하나로 로그인하고, 나만의 Embedded Wallet과 Fan Passport를 안전하게 이어갈 수 있어요.</p>
        </div>
        <button className={styles.googleButton} type="button" disabled={!ready || authenticated} onClick={() => { setError(null); login({ loginMethods: ["google"] }); }}>
          <GoogleMark /><span>{ready ? "Google로 계속하기" : "로그인 준비 중"}</span><ArrowRight />
        </button>
        {testAccountLoginEnabled && (
          <div className={styles.testAccountGroup} role="group" aria-label="개발 환경 Test Account 로그인">
            <span className={styles.divider}>개발 환경 Test Account</span>
            <button
              className={styles.emailButton}
              type="button"
              disabled={!ready || authenticated}
              onClick={() => {
                setError(null);
                login({ loginMethods: ["email"] });
              }}
            >
              <span>Test Account 이메일로 계속하기</span><ArrowRight />
            </button>
            <p>Privy 대시보드에 등록된 Test Account 이메일과 OTP만 사용할 수 있어요.</p>
          </div>
        )}
        <p className={styles.context}>{context}</p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {presentation === "standalone" && <Link className={styles.backLink} href="/">홈으로 돌아가기</Link>}
    </>
  );

  if (presentation === "overlay") {
    const Overlay = mobilePresentation ? BottomSheet : Dialog;
    return (
      <Overlay
        open
        onClose={() => router.back()}
        labelledBy="login-heading"
        describedBy="login-description"
        initialFocusRef={closeButtonRef}
        backdropClassName={styles.modalBackdrop}
        contentClassName={`${styles.panel} ${styles.modalPanel}`}
        closeOnBackdrop
      >
        {content}
      </Overlay>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="login-heading" aria-describedby="login-description">
        {content}
      </section>
    </main>
  );
}
