"use client";

import { useCreateWallet, useLogin, useLoginWithOAuth, usePrivy, useUser } from "@privy-io/react-auth";
import Image, { getImageProps } from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { withLocalePath } from "./locale-path";
import { X } from "lucide-react";
import { AppleMark, ArrowRight, GoogleMark } from "./icons";
import { appendLoginContext, sanitizeAuthIntentId, sanitizeEntity, sanitizeIntent, sanitizeLocale, sanitizeReturnTo } from "./login-intent";
import { BottomSheet, Dialog } from "./ui/overlay/accessible-overlay";
import { FanSiteFooter } from "./fan-shell/fan-site-footer";
import { readAuthIntent } from "./auth-intent";
import { FanAction } from "./fan-ui/fan-action";
import { FanState } from "./fan-ui/fan-state";
import { useAvatarSessionReady } from "./avatar-session-bridge";
import {
  RequestTimeoutError,
  reportRecoveryFailure,
  withOperationDeadline,
  withRequestDeadline,
} from "../features/reliability/client/request-deadline";
import { getSessionStorage } from "../features/reliability/client/session-storage";
import { getOAuthStartGuard } from "../features/reliability/client/oauth-start";
import { signupFunnelTracker, type LoginMeasurementAttempt } from "../features/analytics/client/signup-funnel-tracker";
import { signupStageSchema, type SignupReason } from "../features/analytics/domain/signup-funnel-event";
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
const LOGIN_READINESS_TIMEOUT = "LOGIN_READINESS_TIMEOUT";
const SESSION_SYNCHRONIZATION_TIMEOUT = "SESSION_SYNCHRONIZATION_TIMEOUT";
const SDK_OPERATION_TIMEOUT_MS = 30_000;
const WALLET_RECONCILIATION_TIMEOUT_MS = 5_000;

class StaleLoginIdentityError extends Error {
  constructor() {
    super("Login identity changed");
    this.name = "StaleLoginIdentityError";
  }
}

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
  if (error === LOGIN_READINESS_TIMEOUT) {
    return locale === "ko"
      ? { title: "로그인 준비가 오래 걸리고 있어요.", description: "다시 확인하면 이 화면에서 로그인을 이어갈 수 있어요." }
      : { title: "Sign-in is taking longer than expected.", description: "Check again to continue signing in from this screen." };
  }
  if (error === SESSION_SYNCHRONIZATION_TIMEOUT) {
    return locale === "ko"
      ? { title: "로그인 연결이 오래 걸리고 있어요.", description: "현재 계정을 유지한 채 다시 시도해 주세요." }
      : { title: "Finishing sign-in is taking longer than expected.", description: "Try again with the account you’re currently using." };
  }
  if (error) {
    return locale === "ko"
      ? {
          title: "로그인 정보를 안전하게 연결하지 못했어요.",
          description: "잠시 후 다시 시도해 주세요.",
        }
      : {
          title: "We couldn't finish signing you in.",
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
      : "Finishing sign-in.",
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
  const oauthGuard = getOAuthStartGuard();
  const oauthState = useSyncExternalStore(oauthGuard.subscribe, oauthGuard.getSnapshot, oauthGuard.getServerSnapshot);
  const oauthStarting = oauthState === "starting";
  const oauthRestartRequired = oauthState === "restart-required";
  const [reauthenticationProviders, setReauthenticationProviders] = useState<Array<"google" | "apple">>([]);
  const [reauthenticationStarting, setReauthenticationStarting] = useState(false);
  const [reauthenticationFailed, setReauthenticationFailed] = useState(false);
  const [readinessAttempt, setReadinessAttempt] = useState(0);
  const reauthenticationStartRef = useRef(false);
  const synchronizationRef = useRef<{ userId: string; promise: Promise<void> } | null>(null);
  const walletCreationsRef = useRef(new Map<string, Promise<unknown>>());
  const activeIdentityRef = useRef<string | null>(privyUserId ?? null);
  const identityGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const attemptedSessionUserRef = useRef<string | null>(null);
  const loginMeasurementRef = useRef<LoginMeasurementAttempt | null>(null);
  // Identity lives only in component memory; it is never sent to anonymous analytics.
  const loginMeasurementOwnerRef = useRef<string | null>(null);
  const providerMeasurementRef = useRef<LoginMeasurementAttempt | null>(null);
  const providerCallbackClosedRef = useRef(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const sessionErrorRef = useRef<HTMLDivElement>(null);
  const mobilePresentation = useMobileLoginPresentation();
  const returnTo = useMemo(() => withLocalePath(sanitizeReturnTo(searchParams.get("returnTo")), sanitizeLocale(searchParams.get("locale"))), [searchParams]);
  const intent = useMemo(() => sanitizeIntent(searchParams.get("intent")), [searchParams]);
  const entity = useMemo(() => sanitizeEntity(searchParams.get("entity")), [searchParams]);
  const authIntent = useMemo(() => sanitizeAuthIntentId(searchParams.get("authIntent")), [searchParams]);
  const locale = useMemo(() => sanitizeLocale(searchParams.get("locale")), [searchParams]);
  const activateIdentity = useCallback((userId: string) => {
    if (activeIdentityRef.current !== userId) {
      if (loginMeasurementOwnerRef.current !== null && loginMeasurementOwnerRef.current !== userId) {
        signupFunnelTracker.forgetLoginAttempt();
        loginMeasurementRef.current = null;
        loginMeasurementOwnerRef.current = null;
        providerMeasurementRef.current = null;
        providerCallbackClosedRef.current = true;
      }
      activeIdentityRef.current = userId;
      identityGenerationRef.current += 1;
      synchronizationRef.current = null;
    }
    return identityGenerationRef.current;
  }, []);
  const assertCurrentIdentity = useCallback((userId: string, generation: number) => {
    if (!mountedRef.current || activeIdentityRef.current !== userId || identityGenerationRef.current !== generation) {
      throw new StaleLoginIdentityError();
    }
  }, []);
  const synchronizeSession = useCallback((completedUserId?: string) => {
    const expectedUserId = completedUserId ?? privyUserId;
    if (!expectedUserId) return Promise.resolve();
    if (synchronizationRef.current?.userId === expectedUserId) return synchronizationRef.current.promise;
    const generation = activateIdentity(expectedUserId);
    providerCallbackClosedRef.current = true;
    attemptedSessionUserRef.current = expectedUserId;
    const measurement = loginMeasurementRef.current?.succeeded ? signupFunnelTracker.resumeLogin(locale)
      : loginMeasurementRef.current ?? signupFunnelTracker.resumeLogin(locale);
    loginMeasurementRef.current = measurement;
    loginMeasurementOwnerRef.current = expectedUserId;

    let promise!: Promise<void>;
    promise = (async () => {
      let stage = "login.user";
      try {
        // Headless OAuth does not run Privy's createOnLogin policy. Prepare the
        // same user-owned EVM wallet before the server establishes its session.
        const currentUser = await withOperationDeadline(refreshUser(), SDK_OPERATION_TIMEOUT_MS);
        assertCurrentIdentity(expectedUserId, generation);
        if (currentUser.id !== expectedUserId) throw new StaleLoginIdentityError();
        const hasEmbeddedWallet = (candidate: typeof currentUser) => candidate.linkedAccounts.some((account) =>
          account.type === "wallet" && account.chainType === "ethereum"
          && account.connectorType === "embedded" && account.walletClientType === "privy",
        );
        if (!hasEmbeddedWallet(currentUser)) {
          // Never create an additional wallet or replace an existing identity.
          stage = "login.wallet";
          let walletCreation = walletCreationsRef.current.get(expectedUserId);
          if (!walletCreation) {
            const underlying = Promise.resolve(createWallet({ createAdditional: false }));
            walletCreation = underlying;
            walletCreationsRef.current.set(expectedUserId, underlying);
            void underlying.finally(() => {
              if (walletCreationsRef.current.get(expectedUserId) === underlying) {
                walletCreationsRef.current.delete(expectedUserId);
              }
            }).catch(() => undefined);
          }
          try {
            await withOperationDeadline(walletCreation, SDK_OPERATION_TIMEOUT_MS);
          } catch (walletError) {
            if (!(walletError instanceof RequestTimeoutError)) throw walletError;
            assertCurrentIdentity(expectedUserId, generation);
            // The SDK promise may still be pending after provisioning completed.
            // Reconcile once from the same user's current state; never create again.
            try {
              const reconciledUser = await withOperationDeadline(refreshUser(), WALLET_RECONCILIATION_TIMEOUT_MS);
              assertCurrentIdentity(expectedUserId, generation);
              if (reconciledUser.id !== expectedUserId) throw new StaleLoginIdentityError();
              if (!hasEmbeddedWallet(reconciledUser)) throw walletError;
            } catch (reconciliationError) {
              assertCurrentIdentity(expectedUserId, generation);
              if (reconciliationError instanceof StaleLoginIdentityError) throw reconciliationError;
              throw walletError;
            }
          }
          assertCurrentIdentity(expectedUserId, generation);
        }
        stage = "login.token";
        const token = await withOperationDeadline(getAccessToken(), SDK_OPERATION_TIMEOUT_MS);
        assertCurrentIdentity(expectedUserId, generation);
        if (!token) throw new Error("Missing Privy access token");
        stage = "login.session";
        const { response, body } = await withRequestDeadline(async (signal) => {
          const response = await fetch("/api/auth/session", {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ locale }),
            cache: "no-store",
            signal,
          });
          const body = await response.json().catch(() => null) as {
            profile?: { completed?: boolean };
            error?: { code?: string; providers?: unknown };
          } | null;
          return { response, body };
        }, { timeoutMs: SDK_OPERATION_TIMEOUT_MS });
        assertCurrentIdentity(expectedUserId, generation);
        if (!response.ok) {
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
        assertCurrentIdentity(expectedUserId, generation);
        signupFunnelTracker.result(measurement, "succeeded", "session", "none");
        markAvatarSessionReady(expectedUserId);
        const returnPathname = new URL(returnTo, "https://byus.local").pathname;
        const storedIntent = typeof window === "undefined" ? null : readAuthIntent(getSessionStorage(), authIntent);
        const continuesFanVerification = storedIntent?.actionType === "START_FAN_VERIFICATION"
          || (intent === "passport" && entity !== null && returnPathname === `/c/${entity}/verify`);
        const safeReturnTo = returnPathname === "/onboarding/profile" ? `/?locale=${locale}` : returnTo;
        const destination = body?.profile?.completed
          ? safeReturnTo
          : continuesFanVerification
            ? appendLoginContext("/onboarding/profile", { returnTo, intent, entity, locale, authIntent })
            : safeReturnTo;
        router.replace(destination as Route);
      } catch (caught) {
        if (caught instanceof StaleLoginIdentityError) return;
        reportRecoveryFailure(stage, caught);
        if (!mountedRef.current || activeIdentityRef.current !== expectedUserId || identityGenerationRef.current !== generation) return;
        const reason: SignupReason = caught instanceof RequestTimeoutError ? "timeout"
          : caught instanceof Error && caught.message === VERIFIED_EMAIL_REQUIRED ? "verified_email_required"
            : caught instanceof Error && caught.message === APPLE_REAUTHENTICATION_REQUIRED ? "reauthentication_required" : "session_error";
        const observedStage = signupStageSchema.safeParse(stage.replace(/^login\./, ""));
        signupFunnelTracker.result(measurement, "failed", observedStage.success ? observedStage.data : "session", reason);
        setError(
          caught instanceof Error && [VERIFIED_EMAIL_REQUIRED, APPLE_REAUTHENTICATION_REQUIRED].includes(caught.message)
            ? caught.message
            : caught instanceof RequestTimeoutError
              ? SESSION_SYNCHRONIZATION_TIMEOUT
              : "SESSION_SYNCHRONIZATION_FAILED",
        );
      } finally {
        if (synchronizationRef.current?.promise === promise) synchronizationRef.current = null;
      }
    })();

    synchronizationRef.current = { userId: expectedUserId, promise };
    return promise;
  }, [activateIdentity, assertCurrentIdentity, authIntent, createWallet, entity, getAccessToken, intent, locale, refreshUser, returnTo, router, privyUserId, markAvatarSessionReady]);
  const loginErrorMessage = locale === "en"
    ? testAccountLoginEnabled
      ? "We couldn't complete sign-in. Check your account and verification code, then try again."
      : `We couldn't complete sign-in. Check your Google${appleLoginEnabled ? " or Apple" : ""} account, then try again.`
    : testAccountLoginEnabled
      ? "로그인을 완료하지 못했어요. 계정 정보와 인증 코드를 확인한 뒤 다시 시도해 주세요."
      : appleLoginEnabled
        ? "로그인을 완료하지 못했어요. Google 또는 Apple 계정을 확인한 뒤 다시 시도해 주세요."
        : "로그인을 완료하지 못했어요. Google 계정을 확인한 뒤 다시 시도해 주세요.";
  const loginCallbacks = {
    onComplete: ({ user: completedUser }: { user: { id: string } }) => {
      providerMeasurementRef.current = null;
      providerCallbackClosedRef.current = true;
      return synchronizeSession(completedUser.id);
    },
    onError: () => {
      let measurement = providerMeasurementRef.current;
      if (!measurement && !providerCallbackClosedRef.current && !loginMeasurementRef.current) {
        const pending = signupFunnelTracker.pendingLogin();
        // A fresh document can receive the provider's failure before any session synchronization.
        if (pending?.trigger === "provider" && !pending.failed && !pending.succeeded) {
          measurement = pending;
          loginMeasurementRef.current = pending;
        }
      }
      // A late SDK callback cannot turn a session retry or reauthentication into an OAuth failure.
      if (!providerCallbackClosedRef.current && measurement && measurement === loginMeasurementRef.current) {
        signupFunnelTracker.result(measurement, "failed", "oauth", "provider_error");
      }
      providerMeasurementRef.current = null;
      providerCallbackClosedRef.current = true;
      setError(loginErrorMessage);
    },
  };
  const { login } = useLogin({
    ...loginCallbacks,
  });
  const { initOAuth, loading: oauthLoading } = useLoginWithOAuth(loginCallbacks);

  const loginError = oauthRestartRequired
    ? locale === "ko"
      ? "로그인 연결이 오래 걸리고 있어요. 로그인 화면을 새로 열어 다시 시도해 주세요."
      : "Sign-in is taking longer than expected. Reopen the sign-in page to try again."
    : error ?? (searchParams.get("reauth") === "failed"
      ? locale === "ko" ? "계정을 확인하지 못했어요. 다시 로그인해 주세요." : "We couldn't verify your account. Please sign in again."
      : null);
  const restartOAuthPath = appendLoginContext("/login", { returnTo, locale, intent, entity, authIntent });

  const startOAuthLogin = useCallback((provider: "google" | "apple") => {
    if (oauthGuard.getSnapshot() !== "idle") return;
    setError(null);
    const measurement = signupFunnelTracker.beginLogin(provider, "provider", locale);
    loginMeasurementRef.current = measurement;
    providerMeasurementRef.current = measurement;
    providerCallbackClosedRef.current = false;
    void oauthGuard.start(() => initOAuth({ provider }), SDK_OPERATION_TIMEOUT_MS)
      ?.catch((caught) => {
        reportRecoveryFailure("login.oauth", caught);
        signupFunnelTracker.result(measurement, "failed", "oauth", caught instanceof RequestTimeoutError ? "timeout" : "provider_error");
        if (providerMeasurementRef.current === measurement) providerMeasurementRef.current = null;
        if (mountedRef.current) setError(loginErrorMessage);
      });
  }, [initOAuth, locale, loginErrorMessage, oauthGuard]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      identityGenerationRef.current += 1;
      synchronizationRef.current = null;
      attemptedSessionUserRef.current = null;
    };
  }, []);

  useEffect(() => {
    const currentUserId = privyUserId ?? null;
    if (activeIdentityRef.current === currentUserId) return;
    if (loginMeasurementOwnerRef.current !== null && loginMeasurementOwnerRef.current !== currentUserId) {
      signupFunnelTracker.forgetLoginAttempt();
      loginMeasurementRef.current = null;
      loginMeasurementOwnerRef.current = null;
      providerMeasurementRef.current = null;
      providerCallbackClosedRef.current = true;
    }
    activeIdentityRef.current = currentUserId;
    identityGenerationRef.current += 1;
    synchronizationRef.current = null;
    attemptedSessionUserRef.current = null;
  }, [privyUserId]);

  useEffect(() => {
    if (ready) {
      setError((current) => current === LOGIN_READINESS_TIMEOUT ? null : current);
      return;
    }
    const timeout = window.setTimeout(() => {
      reportRecoveryFailure("login.ready", new RequestTimeoutError(SDK_OPERATION_TIMEOUT_MS));
      signupFunnelTracker.result(loginMeasurementRef.current ?? signupFunnelTracker.pendingLogin(), "failed", "ready", "timeout");
      setError(LOGIN_READINESS_TIMEOUT);
    }, SDK_OPERATION_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [readinessAttempt, ready]);

  useEffect(() => {
    if (ready && authenticated && privyUserId && attemptedSessionUserRef.current !== privyUserId) {
      void synchronizeSession();
    }
  }, [authenticated, ready, privyUserId, synchronizeSession]);

  useEffect(() => {
    if (!(authenticated ? error : loginError)) return;
    if (authenticated) {
      sessionErrorRef.current?.focus();
      return;
    }
    errorRef.current?.focus();
  }, [authenticated, error, loginError]);

  const retrySessionSynchronization = useCallback(() => {
    setError(null);
    if (!synchronizationRef.current) {
      loginMeasurementRef.current = signupFunnelTracker.beginLogin(loginMeasurementRef.current?.provider ?? "unknown", "retry", locale);
      providerMeasurementRef.current = null;
      providerCallbackClosedRef.current = true;
    }
    void synchronizeSession(attemptedSessionUserRef.current ?? undefined);
  }, [locale, synchronizeSession]);

  const retryLoginReadiness = useCallback(() => {
    setError(null);
    setReadinessAttempt((attempt) => attempt + 1);
  }, []);

  const restartLogin = useCallback(async () => {
    try {
      await logout();
      synchronizationRef.current = null;
      attemptedSessionUserRef.current = null;
      activeIdentityRef.current = null;
      identityGenerationRef.current += 1;
      loginMeasurementRef.current = null;
      loginMeasurementOwnerRef.current = null;
      providerMeasurementRef.current = null;
      signupFunnelTracker.forgetLoginAttempt();
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
    const expectedUserId = activeIdentityRef.current;
    const generation = identityGenerationRef.current;
    const measurement = signupFunnelTracker.beginLogin(provider, "reauth", locale);
    loginMeasurementRef.current = measurement;
    providerMeasurementRef.current = null;
    try {
      if (!expectedUserId) throw new StaleLoginIdentityError();
      const token = await withOperationDeadline(getAccessToken(), SDK_OPERATION_TIMEOUT_MS);
      assertCurrentIdentity(expectedUserId, generation);
      if (!token) throw new Error("Missing Privy session");
      const { response, body } = await withRequestDeadline(async (signal) => {
        const response = await fetch("/api/auth/apple/reauth/start", {
          method: "POST", cache: "no-store", signal,
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ provider, returnTo, locale, intent, entity, authIntent }),
        });
        const body = await response.json() as { authorizationUrl?: string };
        return { response, body };
      }, { timeoutMs: SDK_OPERATION_TIMEOUT_MS });
      assertCurrentIdentity(expectedUserId, generation);
      if (!response.ok || !body.authorizationUrl) throw new Error("Reauthentication is unavailable");
      const destination = new URL(body.authorizationUrl);
      const expectedOrigin = provider === "apple" ? "https://appleid.apple.com" : "https://accounts.google.com";
      if (destination.origin !== expectedOrigin) throw new Error("Invalid authentication destination");
      assertCurrentIdentity(expectedUserId, generation);
      window.location.assign(destination.toString());
    } catch (caught) {
      if (caught instanceof StaleLoginIdentityError) return;
      reportRecoveryFailure("login.reauthentication", caught);
      signupFunnelTracker.result(measurement, "failed", "reauthentication", caught instanceof RequestTimeoutError ? "timeout" : "provider_error");
      setReauthenticationFailed(true);
      setError(APPLE_REAUTHENTICATION_REQUIRED);
    } finally {
      reauthenticationStartRef.current = false;
      setReauthenticationStarting(false);
    }
  }, [assertCurrentIdentity, authIntent, entity, getAccessToken, intent, locale, returnTo]);

  const showsSessionState = !ready || authenticated || [
    VERIFIED_EMAIL_REQUIRED,
    APPLE_REAUTHENTICATION_REQUIRED,
    LOGIN_READINESS_TIMEOUT,
    SESSION_SYNCHRONIZATION_TIMEOUT,
    "SESSION_SYNCHRONIZATION_FAILED",
  ].includes(error ?? "");
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
              onClick={error === VERIFIED_EMAIL_REQUIRED
                ? restartLogin
                : error === LOGIN_READINESS_TIMEOUT
                  ? retryLoginReadiness
                  : retrySessionSynchronization}
            >
              {error === VERIFIED_EMAIL_REQUIRED
                ? locale === "ko" ? "다른 계정으로 로그인" : "Sign in with another account"
                : error === LOGIN_READINESS_TIMEOUT
                  ? locale === "ko" ? "다시 확인" : "Check again"
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
          <Link className={styles.brand} href={`/?locale=${locale}`} aria-label={locale === "ko" ? "ByUs 홈으로 돌아가기" : "Return to ByUs home"}><Image src="/images/guest-home/byus-wordmark.svg" alt="ByUs" width={96} height={36} priority /></Link>
          {presentation === "overlay" && (
            <button
              ref={closeButtonRef}
              className={styles.closeButton}
              type="button"
              aria-label={locale === "ko" ? "로그인 창 닫기" : "Close sign-in"}
              onClick={() => router.back()}
            >
              <X aria-hidden="true" />
            </button>
          )}
        </div>
        <div className={styles.copy}>
          <h1 id="login-heading">{locale === "ko" ? "최애와 함께한 순간을 기록하세요." : "Keep a record of moments with your favorites."}</h1>
        </div>
        <button
          className={styles.googleButton}
          type="button"
          disabled={!ready || authenticated || oauthLoading || oauthStarting || oauthRestartRequired}
          aria-busy={!oauthRestartRequired && (authenticated || oauthLoading || oauthStarting)}
          onClick={() => startOAuthLogin("google")}
        >
          <GoogleMark />
          <span>{ready ? locale === "ko" ? "Google로 계속하기" : "Continue with Google" : locale === "ko" ? "로그인 준비 중" : "Preparing sign-in"}</span>
          <ArrowRight />
        </button>
        {appleLoginEnabled && (
          <button
            className={styles.appleButton}
            type="button"
            disabled={!ready || authenticated || oauthLoading || oauthStarting || oauthRestartRequired}
            aria-busy={!oauthRestartRequired && (authenticated || oauthLoading || oauthStarting)}
            onClick={() => startOAuthLogin("apple")}
          >
            <AppleMark />
            <span>{ready ? locale === "ko" ? "Apple로 계속하기" : "Continue with Apple" : locale === "ko" ? "로그인 준비 중" : "Preparing sign-in"}</span>
            <ArrowRight />
          </button>
        )}
        {testAccountLoginEnabled && (
          <div className={styles.testAccountGroup} role="group" aria-label={locale === "ko" ? "개발 환경 Test Account 로그인" : "Development Test Account sign-in"}>
            <span className={styles.divider}>{locale === "ko" ? "개발 환경 Test Account" : "Development Test Account"}</span>
            <button
              className={styles.emailButton}
              type="button"
              disabled={!ready || authenticated || oauthStarting || oauthRestartRequired}
              onClick={() => {
                setError(null);
                loginMeasurementRef.current = signupFunnelTracker.beginLogin("test", "provider", locale);
                providerMeasurementRef.current = loginMeasurementRef.current;
                providerCallbackClosedRef.current = false;
                login({ loginMethods: ["email"] });
              }}
            >
              <span>{locale === "ko" ? "Test Account 이메일로 계속하기" : "Continue with Test Account email"}</span><ArrowRight />
            </button>
            <p>{locale === "ko" ? "Privy 대시보드에 등록된 Test Account 이메일과 OTP만 사용할 수 있어요." : "Use only a Test Account email and verification code registered in the Privy dashboard."}</p>
          </div>
        )}
        {loginError && <p ref={errorRef} className={styles.error} role="alert" tabIndex={-1}>{loginError}</p>}
        {oauthRestartRequired && (
          // A native navigation replaces the document and its pending SDK work.
          // A Next Link/router transition would retain the old OAuth request.
          <a className={`${styles.emailButton} ${styles.restartLink}`} href={restartOAuthPath}>
            {locale === "ko" ? "로그인 다시 시작" : "Restart sign-in"}
          </a>
        )}
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
                alt={locale === "ko" ? "펼쳐진 Fan Passport" : "Open Fan Passport"}
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
