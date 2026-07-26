"use client";

import { useLogin, usePrivy } from "@privy-io/react-auth";
import Image, { getImageProps } from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { ArrowRight, GoogleMark } from "./icons";
import { appendLoginContext, sanitizeAuthIntentId, sanitizeEntity, sanitizeIntent, sanitizeLocale, sanitizeReturnTo } from "./login-intent";
import { BottomSheet, Dialog } from "./ui/overlay/accessible-overlay";
import { FanSiteFooter } from "./fan-shell/fan-site-footer";
import { readAuthIntent } from "./auth-intent";
import { FanAction } from "./fan-ui/fan-action";
import { FanState } from "./fan-ui/fan-state";
import styles from "./login-page.module.css";

const loginBackground = {
  desktop: "/images/login/spectrum-light.webp",
  mobile: "/images/login/spectrum-light-mobile.webp",
} as const;

const passportPreview = "/images/guest-home/passport-open-blank-9-transparent.png";

type LoginPageProps = {
  presentation?: "standalone" | "overlay";
  testAccountLoginEnabled?: boolean;
};

function loginSessionCopy({
  locale,
  ready,
  error,
}: {
  locale: "ko" | "en";
  ready: boolean;
  error: boolean;
}): { title: string; description?: string } {
  if (error) {
    return locale === "ko"
      ? {
          title: "로그인 정보를 안전하게 연결하지 못했어요.",
          description: "잠시 후 다시 시도해 주세요.",
        }
      : {
          title: "We couldn't connect your sign-in.",
          description: "Please try again in a moment.",
        };
  }
  if (!ready) {
    return {
      title: locale === "ko"
        ? "로그인 상태를 확인하고 있어요."
        : "Checking your sign-in.",
    };
  }
  return {
    title: locale === "ko"
      ? "로그인 상태를 연결하고 있어요."
      : "Connecting your sign-in.",
  };
}

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
  const errorRef = useRef<HTMLParagraphElement>(null);
  const sessionErrorRef = useRef<HTMLDivElement>(null);
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
        const returnPathname = new URL(returnTo, "https://byus.local").pathname;
        const storedIntent = typeof window === "undefined" ? null : readAuthIntent(window.sessionStorage, authIntent);
        const continuesFanVerification = storedIntent?.actionType === "START_FAN_VERIFICATION"
          || (intent === "passport" && entity !== null && returnPathname === `/c/${entity}/verify`);
        const safeReturnTo = returnPathname === "/onboarding/profile" ? `/?locale=${locale}` : returnTo;
        const destination = body.profile?.completed
          ? safeReturnTo
          : continuesFanVerification
            ? appendLoginContext("/onboarding/profile", { returnTo, intent, entity, locale, authIntent })
            : safeReturnTo;
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

  useEffect(() => {
    if (!error) return;
    if (authenticated) {
      sessionErrorRef.current?.focus();
      return;
    }
    errorRef.current?.focus();
  }, [authenticated, error]);

  const retrySessionSynchronization = useCallback(() => {
    setError(null);
    void synchronizeSession();
  }, [synchronizeSession]);

  const showsSessionState = !ready || authenticated;
  const sessionCopy = loginSessionCopy({
    locale,
    ready,
    error: error !== null,
  });
  const sessionState = (
    <div className={styles.sessionContents} data-fan-surface lang={locale}>
      {presentation === "overlay" ? (
        <div className={styles.panelHeader}>
          <button
            ref={closeButtonRef}
            className={styles.closeButton}
            type="button"
            aria-label={locale === "ko" ? "로그인 창 닫기" : "Close sign-in"}
            onClick={() => router.back()}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <div
        id="login-session-heading"
        ref={error ? sessionErrorRef : undefined}
        tabIndex={error ? -1 : undefined}
      >
        <FanState
          kind={error ? "error" : "loading"}
          title={sessionCopy.title}
          description={sessionCopy.description}
          actions={error ? (
            <FanAction variant="neutral" onClick={retrySessionSynchronization}>
              {locale === "ko" ? "다시 시도" : "Try again"}
            </FanAction>
          ) : undefined}
        />
      </div>
    </div>
  );

  if (showsSessionState) {
    if (presentation === "overlay") {
      const Overlay = mobilePresentation ? BottomSheet : Dialog;
      return (
        <Overlay
          open
          onClose={() => router.back()}
          labelledBy="login-session-heading"
          initialFocusRef={closeButtonRef}
          backdropClassName={styles.modalBackdrop}
          contentClassName={`${styles.panel} ${styles.modalPanel}`}
          closeOnBackdrop
        >
          {sessionState}
        </Overlay>
      );
    }

    return (
      <main className={styles.sessionPage} data-fan-surface lang={locale}>
        {sessionState}
      </main>
    );
  }

  const desktopBackground = getImageProps({
    alt: "",
    src: loginBackground.desktop,
    width: 1536,
    height: 1024,
    quality: 78,
    sizes: "100vw",
  }).props;
  const mobileBackground = getImageProps({
    alt: "",
    src: loginBackground.mobile,
    width: 768,
    height: 1024,
    quality: 76,
    sizes: "100vw",
  }).props;

  const content = (
    <div className={styles.contents} data-fan-surface lang={locale}>
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
        </div>
        <button
          className={styles.googleButton}
          type="button"
          disabled={!ready || authenticated}
          aria-busy={authenticated}
          onClick={() => { setError(null); login({ loginMethods: ["google"] }); }}
        >
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
        {error && <p ref={errorRef} className={styles.error} role="alert" tabIndex={-1}>{error}</p>}
    </div>
  );

  if (presentation === "overlay") {
    const Overlay = mobilePresentation ? BottomSheet : Dialog;
    return (
      <Overlay
        open
        onClose={() => router.back()}
        labelledBy="login-heading"
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
    <main className={styles.page} data-fan-surface lang={locale}>
      <picture className={styles.background} data-decorative-background>
        <source media="(max-width: 47.999rem)" srcSet={mobileBackground.srcSet} />
        {/* impeccable-disable-next-line broken-image: src is provided by getImageProps */}
        <img {...desktopBackground} alt="" />
      </picture>
      <div className={styles.authStage}>
        <section
          className={styles.gatewayPanel}
          aria-labelledby="login-heading"
          data-login-layout="passport-gateway"
        >
          <div className={styles.passportVisual}>
            <span className={styles.passportLabel}>YOUR FAN PASSPORT</span>
            <div className={styles.passportArtwork}>
              <Image
                className={styles.passportImage}
                src={passportPreview}
                alt="펼쳐진 Fan Passport"
                width={1536}
                height={1024}
                sizes="(min-width: 768px) 390px, 1px"
                priority
              />
            </div>
          </div>
          <div className={styles.loginColumn}>
            {content}
          </div>
        </section>
      </div>
      <FanSiteFooter locale={locale} />
    </main>
  );
}
