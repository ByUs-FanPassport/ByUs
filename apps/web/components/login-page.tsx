"use client";

import { useCreateWallet, useLogin, useLoginWithOAuth, usePrivy, useUser } from "@privy-io/react-auth";
import Image, { getImageProps } from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { AppleMark, ArrowRight, GoogleMark } from "./icons";
import { appendLoginContext, sanitizeAuthIntentId, sanitizeEntity, sanitizeIntent, sanitizeLocale, sanitizeReturnTo } from "./login-intent";
import { BottomSheet, Dialog } from "./ui/overlay/accessible-overlay";
import { FanSiteFooter } from "./fan-shell/fan-site-footer";
import { readAuthIntent } from "./auth-intent";
import { FanAction } from "./fan-ui/fan-action";
import { FanState } from "./fan-ui/fan-state";
import { useAvatarSessionReady } from "./avatar-session-bridge";
import styles from "./login-page.module.css";

const loginBackground = {
  desktop: "/images/login/spectrum-light.webp",
  mobile: "/images/login/spectrum-light-mobile.webp",
} as const;

const passportPreview = "/images/guest-home/passport-open-blank-9-transparent.png";

type LoginPageProps = {
  presentation?: "standalone" | "overlay";
  appleLoginEnabled?: boolean;
  testAccountLoginEnabled?: boolean;
};

const VERIFIED_EMAIL_REQUIRED = "VERIFIED_EMAIL_REQUIRED";
const APPLE_REAUTHENTICATION_REQUIRED = "APPLE_REAUTHENTICATION_REQUIRED";

function loginSessionCopy({
  locale,
  ready,
  error,
}: {
  locale: "ko" | "en";
  ready: boolean;
  error: string | null;
}): { title: string; description?: string } {
  if (error === APPLE_REAUTHENTICATION_REQUIRED) {
    return locale === "ko"
      ? { title: "계정을 다시 확인해 주세요.", description: "Apple 계정 연결이 변경되었어요. 기존 계정으로 인증하면 계속할 수 있어요." }
      : { title: "Verify your account again.", description: "Your Apple account connection has changed. Verify with your existing account to continue." };
  }
  if (error === VERIFIED_EMAIL_REQUIRED) {
    return locale === "ko"
      ? {
          title: "이 계정에서 확인된 이메일을 찾을 수 없어요.",
          description: "로그아웃한 뒤 이메일 공유가 가능한 계정으로 다시 로그인해 주세요.",
        }
      : {
          title: "We couldn't find a verified email for this account.",
          description: "Sign out, then choose an account that can share a verified email.",
        };
  }
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
  appleLoginEnabled = false,
  testAccountLoginEnabled = false,
}: LoginPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { ready, authenticated, getAccessToken, logout, user } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { refreshUser } = useUser();
  const privyUserId = user?.id;
  const markAvatarSessionReady = useAvatarSessionReady();
  const [error, setError] = useState<string | null>(null);
  const [oauthStarting, setOauthStarting] = useState(false);
  const [reauthenticationProviders, setReauthenticationProviders] = useState<Array<"google" | "apple">>([]);
  const [reauthenticationStarting, setReauthenticationStarting] = useState(false);
  const [reauthenticationFailed, setReauthenticationFailed] = useState(false);
  const reauthenticationStartRef = useRef(false);
  const oauthStartRef = useRef(false);
  const synchronizationRef = useRef<Promise<void> | null>(null);
  const attemptedSessionUserRef = useRef<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const sessionErrorRef = useRef<HTMLDivElement>(null);
  const mobilePresentation = useMobileLoginPresentation();
  const returnTo = useMemo(() => sanitizeReturnTo(searchParams.get("returnTo")), [searchParams]);
  const intent = useMemo(() => sanitizeIntent(searchParams.get("intent")), [searchParams]);
  const entity = useMemo(() => sanitizeEntity(searchParams.get("entity")), [searchParams]);
  const authIntent = useMemo(() => sanitizeAuthIntentId(searchParams.get("authIntent")), [searchParams]);
  const locale = useMemo(() => sanitizeLocale(searchParams.get("locale")), [searchParams]);
  const synchronizeSession = useCallback((completedUserId?: string) => {
    if (synchronizationRef.current) return synchronizationRef.current;
    attemptedSessionUserRef.current = completedUserId ?? privyUserId ?? null;

    synchronizationRef.current = (async () => {
      try {
        // Headless OAuth does not run Privy's createOnLogin policy. Prepare the
        // same user-owned EVM wallet before the server establishes its session.
        const expectedUserId = completedUserId ?? privyUserId;
        const currentUser = await refreshUser();
        if (!expectedUserId || currentUser.id !== expectedUserId) {
          throw new Error("Privy user changed during sign-in");
        }
        const hasWallet = currentUser.linkedAccounts.some((account) =>
          account.type === "wallet" && account.chainType === "ethereum"
          && account.connectorType === "embedded" && account.walletClientType === "privy",
        );
        if (!hasWallet) {
          // Never create an additional wallet or replace an existing identity.
          await createWallet({ createAdditional: false });
        }
        const token = await getAccessToken();
        if (!token) throw new Error("Missing Privy access token");
        const response = await fetch("/api/auth/session", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ locale }),
          cache: "no-store",
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: { code?: string; providers?: unknown } } | null;
          if (response.status === 403 && body?.error?.code === APPLE_REAUTHENTICATION_REQUIRED) {
            const providers = Array.isArray(body.error.providers)
              ? body.error.providers.filter((provider): provider is "apple" | "google" => provider === "apple" || provider === "google")
              : [];
            setReauthenticationProviders([...new Set(providers)]);
            throw new Error(APPLE_REAUTHENTICATION_REQUIRED);
          }
          if (response.status === 403 && body?.error?.code === VERIFIED_EMAIL_REQUIRED) {
            throw new Error(VERIFIED_EMAIL_REQUIRED);
          }
          throw new Error("Session synchronization failed");
        }
        const body = await response.json() as { profile?: { completed?: boolean } };
        const synchronizedUserId = completedUserId ?? privyUserId;
        if (synchronizedUserId) markAvatarSessionReady(synchronizedUserId);
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
      } catch (caught) {
        synchronizationRef.current = null;
        setError(
          caught instanceof Error && [VERIFIED_EMAIL_REQUIRED, APPLE_REAUTHENTICATION_REQUIRED].includes(caught.message)
            ? caught.message
            : "로그인 정보를 안전하게 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
        );
      }
    })();

    return synchronizationRef.current;
  }, [authIntent, createWallet, entity, getAccessToken, intent, locale, refreshUser, returnTo, router, privyUserId, markAvatarSessionReady]);
  const loginErrorMessage = testAccountLoginEnabled
    ? "로그인을 완료하지 못했어요. 계정 정보와 인증 코드를 확인한 뒤 다시 시도해 주세요."
    : appleLoginEnabled
      ? "로그인을 완료하지 못했어요. Google 또는 Apple 계정을 확인한 뒤 다시 시도해 주세요."
      : "로그인을 완료하지 못했어요. Google 계정을 확인한 뒤 다시 시도해 주세요.";
  const loginCallbacks = {
    onComplete: ({ user: completedUser }: { user: { id: string } }) => synchronizeSession(completedUser.id),
    onError: () => setError(loginErrorMessage),
  };
  const { login } = useLogin({
    ...loginCallbacks,
  });
  const { initOAuth, loading: oauthLoading } = useLoginWithOAuth(loginCallbacks);

  const startOAuthLogin = useCallback((provider: "google" | "apple") => {
    if (oauthStartRef.current) return;
    oauthStartRef.current = true;
    setOauthStarting(true);
    setError(null);
    void initOAuth({ provider })
      .catch(() => setError(loginErrorMessage))
      .finally(() => {
        oauthStartRef.current = false;
        setOauthStarting(false);
      });
  }, [initOAuth, loginErrorMessage]);

  useEffect(() => {
    if (ready && authenticated && privyUserId && attemptedSessionUserRef.current !== privyUserId) {
      void synchronizeSession();
    }
  }, [authenticated, ready, privyUserId, synchronizeSession]);

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

  const restartLogin = useCallback(async () => {
    try {
      await logout();
      synchronizationRef.current = null;
      attemptedSessionUserRef.current = null;
      setError(null);
      setReauthenticationProviders([]);
    } catch {
      setError("로그아웃하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  }, [logout]);

  const startReauthentication = useCallback(async (provider: "google" | "apple") => {
    if (reauthenticationStartRef.current) return;
    reauthenticationStartRef.current = true;
    setReauthenticationStarting(true);
    setReauthenticationFailed(false);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Missing Privy session");
      const response = await fetch("/api/auth/apple/reauth/start", {
        method: "POST", cache: "no-store",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ provider, returnTo, locale, intent, entity, authIntent }),
      });
      const body = await response.json() as { authorizationUrl?: string };
      if (!response.ok || !body.authorizationUrl) throw new Error("Reauthentication is unavailable");
      const destination = new URL(body.authorizationUrl);
      const expectedOrigin = provider === "apple" ? "https://appleid.apple.com" : "https://accounts.google.com";
      if (destination.origin !== expectedOrigin) throw new Error("Invalid authentication destination");
      window.location.assign(destination.toString());
    } catch {
      setReauthenticationFailed(true);
      setError(APPLE_REAUTHENTICATION_REQUIRED);
    } finally {
      reauthenticationStartRef.current = false;
      setReauthenticationStarting(false);
    }
  }, [authIntent, entity, getAccessToken, intent, locale, returnTo]);

  const showsSessionState = !ready || authenticated;
  const sessionCopy = loginSessionCopy({
    locale,
    ready,
    error,
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
          description={error === APPLE_REAUTHENTICATION_REQUIRED && reauthenticationProviders.length === 0
            ? locale === "ko" ? "연결된 로그인 수단을 사용할 수 없어 현재 이 계정으로 로그인할 수 없어요." : "The linked sign-in methods are unavailable, so this account cannot sign in right now."
            : error === APPLE_REAUTHENTICATION_REQUIRED && (reauthenticationFailed || searchParams.get("reauth") === "failed")
              ? locale === "ko" ? "인증을 완료하지 못했어요. 기존 계정으로 다시 인증해 주세요." : "Verification wasn't completed. Please verify with your existing account again."
            : sessionCopy.description}
          actions={error === APPLE_REAUTHENTICATION_REQUIRED ? (
            <>
              {reauthenticationProviders.map((provider) => (
                <FanAction key={provider} variant="neutral" disabled={reauthenticationStarting}
                  aria-busy={reauthenticationStarting} onClick={() => void startReauthentication(provider)}>
                  {locale === "ko" ? `${provider === "google" ? "Google" : "Apple"}로 인증` : `Verify with ${provider === "google" ? "Google" : "Apple"}`}
                </FanAction>
              ))}
              {reauthenticationProviders.length === 0 && (
                <FanAction variant="neutral" onClick={restartLogin}>
                  {locale === "ko" ? "다른 계정으로 로그인" : "Sign in with another account"}
                </FanAction>
              )}
            </>
          ) : error ? (
            <FanAction
              variant="neutral"
              onClick={error === VERIFIED_EMAIL_REQUIRED ? restartLogin : retrySessionSynchronization}
            >
              {error === VERIFIED_EMAIL_REQUIRED
                ? locale === "ko" ? "다른 계정으로 로그인" : "Sign in with another account"
                : locale === "ko" ? "다시 시도" : "Try again"}
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
          disabled={!ready || authenticated || oauthLoading || oauthStarting}
          aria-busy={authenticated || oauthLoading || oauthStarting}
          onClick={() => startOAuthLogin("google")}
        >
          <GoogleMark />
          <span>{ready ? locale === "ko" ? "Google로 계속하기" : "Continue with Google" : "로그인 준비 중"}</span>
          <ArrowRight />
        </button>
        {appleLoginEnabled && (
          <button
            className={styles.appleButton}
            type="button"
            disabled={!ready || authenticated || oauthLoading || oauthStarting}
            aria-busy={authenticated || oauthLoading || oauthStarting}
            onClick={() => startOAuthLogin("apple")}
          >
            <AppleMark />
            <span>{ready ? locale === "ko" ? "Apple로 계속하기" : "Continue with Apple" : "로그인 준비 중"}</span>
            <ArrowRight />
          </button>
        )}
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
