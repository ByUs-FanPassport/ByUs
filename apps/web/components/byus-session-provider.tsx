"use client";

import { useCreateWallet, usePrivy, useUser } from "@privy-io/react-auth";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { readAuthIntent } from "./auth-intent";
import { useAvatarSessionReady, useAvatarSessionReset } from "./avatar-session-bridge";
import { appendLoginContext, sanitizeAuthIntentId, sanitizeEntity, sanitizeIntent, sanitizeLocale, sanitizeReturnTo, type LoginContext } from "./login-intent";
import { withLocalePath } from "./locale-path";
import { toContentLocale } from "../i18n/locales";
import { signupFunnelTracker } from "../features/analytics/client/signup-funnel-tracker";
import { signupStageSchema, type SignupReason, type WalletDiagnostic } from "../features/analytics/domain/signup-funnel-event";
import { RequestTimeoutError, reportRecoveryFailure, withOperationDeadline, withRequestDeadline } from "../features/reliability/client/request-deadline";
import { getSessionStorage } from "../features/reliability/client/session-storage";

export const VERIFIED_EMAIL_REQUIRED = "VERIFIED_EMAIL_REQUIRED";
export const APPLE_REAUTHENTICATION_REQUIRED = "APPLE_REAUTHENTICATION_REQUIRED";
export const SESSION_SYNCHRONIZATION_TIMEOUT = "SESSION_SYNCHRONIZATION_TIMEOUT";
export const SESSION_SYNCHRONIZATION_FAILED = "SESSION_SYNCHRONIZATION_FAILED";
const SDK_OPERATION_TIMEOUT_MS = 30_000;
const WALLET_RECONCILIATION_TIMEOUT_MS = 5_000;

class StaleLoginIdentityError extends Error {
  constructor() { super("Login identity changed"); this.name = "StaleLoginIdentityError"; }
}

export interface ByUsSessionSnapshot { ready: boolean; pending: boolean; ownerId: string | null; generation: number; destination: string | null; }
export interface SessionTransitionInput extends LoginContext { ownerId: string; }
export interface ByUsSessionContextValue extends ByUsSessionSnapshot {
  error: string | null;
  recoveryPath: string | null;
  reauthenticationProviders: Array<"google" | "apple">;
  beginTransition(input: SessionTransitionInput): boolean;
  retryTransition(): Promise<void>;
  resetTransition(): void;
}

const DEFAULT_SESSION: ByUsSessionContextValue = {
  ready: true, pending: false, ownerId: null, generation: 0, destination: null, error: null, recoveryPath: null, reauthenticationProviders: [],
  beginTransition: () => false, retryTransition: async () => {}, resetTransition: () => {},
};
const ByUsSessionContext = createContext<ByUsSessionContextValue>(DEFAULT_SESSION);
export function useByUsSession(): ByUsSessionContextValue { return useContext(ByUsSessionContext); }

type ActiveTransition = SessionTransitionInput & {
  generation: number;
  provisionalDestination: string;
  loginPath: string;
  seenSdkOwner: boolean;
  sourceLocation: string | null;
};

function browserLocation(): string | null {
  if (typeof window === "undefined") return null;
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function normalizedInput(input: SessionTransitionInput): Omit<ActiveTransition, "generation" | "seenSdkOwner"> {
  const locale = sanitizeLocale(input.locale);
  const returnTo = withLocalePath(sanitizeReturnTo(input.returnTo), locale);
  const intent = sanitizeIntent(input.intent);
  const entity = sanitizeEntity(input.entity);
  const authIntent = sanitizeAuthIntentId(input.authIntent);
  const returnPathname = new URL(returnTo, "https://byus.local").pathname;
  const safeReturnTo = returnPathname === "/onboarding/profile" ? `/?locale=${locale}` : returnTo;
  return {
    ownerId: input.ownerId, returnTo, locale, intent, entity, authIntent,
    provisionalDestination: safeReturnTo,
    loginPath: appendLoginContext("/login", { returnTo, locale, intent, entity, authIntent }),
    sourceLocation: browserLocation(),
  };
}

export function ByUsSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { ready: sdkReady, authenticated, user, getAccessToken } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { refreshUser } = useUser();
  const markAvatarSessionReady = useAvatarSessionReady();
  const resetAvatarSession = useAvatarSessionReset();
  const [snapshot, setSnapshot] = useState<ByUsSessionSnapshot>(DEFAULT_SESSION);
  const [error, setError] = useState<string | null>(null);
  const [recoveryPath, setRecoveryPath] = useState<string | null>(null);
  const [reauthenticationProviders, setReauthenticationProviders] = useState<Array<"google" | "apple">>([]);
  const activeRef = useRef<ActiveTransition | null>(null);
  const synchronizationRef = useRef<{ ownerId: string; generation: number; promise: Promise<void> } | null>(null);
  const walletCreationsRef = useRef(new Map<string, Promise<unknown>>());
  const generationRef = useRef(0);
  const previousSdkOwnerRef = useRef<string | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const sdkOwnerId = sdkReady && authenticated ? user?.id ?? null : null;
  const latestSdkOwnerRef = useRef(sdkOwnerId);

  useLayoutEffect(() => {
    latestSdkOwnerRef.current = sdkOwnerId;
    const active = activeRef.current;
    if (active && sdkOwnerId === active.ownerId) active.seenSdkOwner = true;
  }, [sdkOwnerId]);

  const invalidate = useCallback(() => {
    generationRef.current += 1;
    activeRef.current = null;
    synchronizationRef.current = null;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    signupFunnelTracker.forgetLoginAttempt();
    resetAvatarSession();
    setError(null);
    setRecoveryPath(null);
    setReauthenticationProviders([]);
    setSnapshot({ ready: true, pending: false, ownerId: null, generation: generationRef.current, destination: null });
  }, [resetAvatarSession]);

  const assertCurrent = useCallback((ownerId: string, generation: number) => {
    const active = activeRef.current;
    const latestSdkOwner = latestSdkOwnerRef.current;
    if (!active || active.ownerId !== ownerId || active.generation !== generation || generationRef.current !== generation
      || (latestSdkOwner !== null && latestSdkOwner !== ownerId) || (active.seenSdkOwner && latestSdkOwner === null)) {
      throw new StaleLoginIdentityError();
    }
  }, []);

  const invalidateIfCurrent = useCallback((ownerId: string, generation: number) => {
    const active = activeRef.current;
    if (active?.ownerId === ownerId && active.generation === generation) invalidate();
  }, [invalidate]);

  const synchronize = useCallback((transition: ActiveTransition): Promise<void> => {
    const existing = synchronizationRef.current;
    if (existing?.ownerId === transition.ownerId && existing.generation === transition.generation) return existing.promise;
    const { ownerId, generation, locale, intent, entity, authIntent, returnTo, provisionalDestination, loginPath } = transition;
    const measurement = signupFunnelTracker.resumeLogin(toContentLocale(locale));
    let promise!: Promise<void>;
    promise = (async () => {
      let stage = "login.user";
      let walletDiagnostic: WalletDiagnostic | undefined;
      let requestController: AbortController | null = null;
      let diagnosticClockValid = true;
      const diagnosticNow = () => {
        try { const now = performance.now(); if (Number.isFinite(now)) return now; } catch { /* optional diagnostic */ }
        diagnosticClockValid = false; return 0;
      };
      const elapsed = (start: number, cap: number) => Math.min(cap, Math.max(0, Math.round(diagnosticNow() - start))) || 0;
      try {
        // Always refresh: the SDK callback may precede React's authenticated snapshot.
        const currentUser = await withOperationDeadline(refreshUser(), SDK_OPERATION_TIMEOUT_MS);
        assertCurrent(ownerId, generation);
        if (currentUser.id !== ownerId) throw new StaleLoginIdentityError();
        const hasEmbeddedWallet = (candidate: typeof currentUser) => candidate.linkedAccounts.some((account) =>
          account.type === "wallet" && account.chainType === "ethereum" && account.connectorType === "embedded" && account.walletClientType === "privy",
        );
        if (!hasEmbeddedWallet(currentUser)) {
          stage = "login.wallet";
          const waitStarted = diagnosticNow();
          try {
            let walletCreation = walletCreationsRef.current.get(ownerId);
            if (!walletCreation) {
              const underlying = Promise.resolve(createWallet({ createAdditional: false }));
              walletCreation = underlying;
              walletCreationsRef.current.set(ownerId, underlying);
              void underlying.finally(() => {
                if (walletCreationsRef.current.get(ownerId) === underlying) walletCreationsRef.current.delete(ownerId);
              }).catch(() => undefined);
            }
            await withOperationDeadline(walletCreation, SDK_OPERATION_TIMEOUT_MS);
            walletDiagnostic = { walletWaitOutcome: "succeeded", walletWaitMs: elapsed(waitStarted, 120_000), walletReconciliation: "not_needed", walletReconciliationMs: 0 };
          } catch (walletError) {
            walletDiagnostic = { walletWaitOutcome: walletError instanceof RequestTimeoutError ? "timeout" : "error", walletWaitMs: elapsed(waitStarted, 120_000), walletReconciliation: "not_needed", walletReconciliationMs: 0 };
            if (!(walletError instanceof RequestTimeoutError)) throw walletError;
            assertCurrent(ownerId, generation);
            const reconciliationStarted = diagnosticNow();
            let reconciliation: WalletDiagnostic["walletReconciliation"];
            try {
              const reconciledUser = await withOperationDeadline(refreshUser(), WALLET_RECONCILIATION_TIMEOUT_MS);
              assertCurrent(ownerId, generation);
              if (reconciledUser.id !== ownerId) throw new StaleLoginIdentityError();
              reconciliation = hasEmbeddedWallet(reconciledUser) ? "wallet_found" : "wallet_missing";
            } catch (reconciliationError) {
              assertCurrent(ownerId, generation);
              if (reconciliationError instanceof StaleLoginIdentityError) throw reconciliationError;
              reconciliation = reconciliationError instanceof RequestTimeoutError ? "timeout" : "error";
            }
            walletDiagnostic = { ...walletDiagnostic, walletReconciliation: reconciliation, walletReconciliationMs: elapsed(reconciliationStarted, 30_000) };
            if (reconciliation !== "wallet_found") throw walletError;
          }
          assertCurrent(ownerId, generation);
        }
        stage = "login.token";
        const token = await withOperationDeadline(getAccessToken(), SDK_OPERATION_TIMEOUT_MS);
        assertCurrent(ownerId, generation);
        if (!token) throw new Error("Missing Privy access token");
        stage = "login.session";
        const activeRequestController = new AbortController();
        requestController = activeRequestController;
        requestControllerRef.current?.abort();
        requestControllerRef.current = activeRequestController;
        const { response, body } = await withRequestDeadline(async (signal) => {
          const response = await fetch("/api/auth/session", {
            method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({ locale: toContentLocale(locale) }), cache: "no-store", signal,
          });
          const body = await response.json().catch(() => null) as { profile?: { completed?: boolean }; error?: { code?: string; providers?: unknown } } | null;
          return { response, body };
        }, { timeoutMs: SDK_OPERATION_TIMEOUT_MS, signal: activeRequestController.signal });
        assertCurrent(ownerId, generation);
        if (!response.ok) {
          if (response.status === 403 && body?.error?.code === APPLE_REAUTHENTICATION_REQUIRED) {
            const providers = Array.isArray(body.error.providers)
              ? body.error.providers.filter((provider): provider is "apple" | "google" => provider === "apple" || provider === "google") : [];
            setReauthenticationProviders([...new Set(providers)]);
            throw new Error(APPLE_REAUTHENTICATION_REQUIRED);
          }
          if (response.status === 403 && body?.error?.code === VERIFIED_EMAIL_REQUIRED) throw new Error(VERIFIED_EMAIL_REQUIRED);
          throw new Error("Session synchronization failed");
        }
        assertCurrent(ownerId, generation);
        signupFunnelTracker.result(measurement, "succeeded", "session", "none", diagnosticClockValid ? walletDiagnostic : undefined);
        markAvatarSessionReady(ownerId);
        const returnPathname = new URL(returnTo, "https://byus.local").pathname;
        const storedIntent = readAuthIntent(getSessionStorage(), authIntent);
        const continuesFanVerification = storedIntent?.actionType === "START_FAN_VERIFICATION"
          || (intent === "passport" && entity !== null && returnPathname === `/c/${entity}/verify`);
        const destination = body?.profile?.completed || !continuesFanVerification
          ? provisionalDestination : appendLoginContext("/onboarding/profile", { returnTo, intent, entity, locale, authIntent });
        activeRef.current = { ...transition, provisionalDestination: destination };
        setError(null);
        setSnapshot({ ready: true, pending: false, ownerId, generation, destination });
        const location = browserLocation();
        // LoginPage owns return navigation after the SDK has cleaned its OAuth URL.
        if (destination !== provisionalDestination && location === provisionalDestination) router.replace(destination as Route);
      } catch (caught) {
        if (caught instanceof StaleLoginIdentityError) {
          invalidateIfCurrent(ownerId, generation);
          return;
        }
        reportRecoveryFailure(stage, caught);
        try { assertCurrent(ownerId, generation); } catch { return; }
        const reason: SignupReason = caught instanceof RequestTimeoutError ? "timeout"
          : caught instanceof Error && caught.message === VERIFIED_EMAIL_REQUIRED ? "verified_email_required"
            : caught instanceof Error && caught.message === APPLE_REAUTHENTICATION_REQUIRED ? "reauthentication_required" : "session_error";
        const observedStage = signupStageSchema.safeParse(stage.replace(/^login\./, ""));
        signupFunnelTracker.result(measurement, "failed", observedStage.success ? observedStage.data : "session", reason, diagnosticClockValid ? walletDiagnostic : undefined);
        const nextError = caught instanceof Error && [VERIFIED_EMAIL_REQUIRED, APPLE_REAUTHENTICATION_REQUIRED].includes(caught.message)
          ? caught.message : caught instanceof RequestTimeoutError ? SESSION_SYNCHRONIZATION_TIMEOUT : SESSION_SYNCHRONIZATION_FAILED;
        setError(nextError);
        setSnapshot({ ready: false, pending: false, ownerId, generation, destination: null });
        const location = browserLocation();
        if (location === provisionalDestination || location === transition.sourceLocation) router.replace(loginPath as Route);
      } finally {
        if (synchronizationRef.current?.promise === promise) synchronizationRef.current = null;
        if (requestControllerRef.current === requestController) requestControllerRef.current = null;
      }
    })();
    synchronizationRef.current = { ownerId, generation, promise };
    return promise;
  }, [assertCurrent, createWallet, getAccessToken, invalidateIfCurrent, markAvatarSessionReady, refreshUser, router]);

  const beginTransition = useCallback((input: SessionTransitionInput) => {
    const normalized = normalizedInput(input);
    const currentSdkOwner = latestSdkOwnerRef.current;
    if (currentSdkOwner && currentSdkOwner !== normalized.ownerId) {
      return false;
    }
    const current = activeRef.current;
    if (current?.ownerId === normalized.ownerId && synchronizationRef.current?.generation === current.generation) return true;
    generationRef.current += 1;
    const transition: ActiveTransition = { ...normalized, generation: generationRef.current, seenSdkOwner: currentSdkOwner === normalized.ownerId };
    activeRef.current = transition;
    resetAvatarSession();
    setError(null); setReauthenticationProviders([]);
    setRecoveryPath(transition.loginPath);
    setSnapshot({ ready: false, pending: true, ownerId: transition.ownerId, generation: transition.generation, destination: transition.provisionalDestination });
    void synchronize(transition);
    return true;
  }, [resetAvatarSession, synchronize]);

  const retryTransition = useCallback(() => {
    const current = activeRef.current;
    if (!current) return Promise.resolve();
    generationRef.current += 1;
    const transition = { ...current, ...normalizedInput(current), generation: generationRef.current };
    activeRef.current = transition;
    resetAvatarSession();
    setError(null); setReauthenticationProviders([]);
    setSnapshot({ ready: false, pending: true, ownerId: transition.ownerId, generation: transition.generation, destination: transition.provisionalDestination });
    return synchronize(transition);
  }, [resetAvatarSession, synchronize]);

  useEffect(() => {
    if (!sdkReady) return;
    const sdkOwner = authenticated ? user?.id ?? null : null;
    const active = activeRef.current;
    if (active) {
      if (sdkOwner === active.ownerId) active.seenSdkOwner = true;
      else if (sdkOwner !== null || active.seenSdkOwner || previousSdkOwnerRef.current !== null) invalidate();
    }
    previousSdkOwnerRef.current = sdkOwner;
  }, [authenticated, invalidate, sdkReady, user?.id]);

  useEffect(() => () => {
    generationRef.current += 1;
    activeRef.current = null;
    synchronizationRef.current = null;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
  }, []);

  const identityMismatch = Boolean(snapshot.ownerId && sdkReady && sdkOwnerId !== snapshot.ownerId);
  const value = useMemo<ByUsSessionContextValue>(() => ({
    ...snapshot,
    ready: identityMismatch ? false : snapshot.ready,
    pending: identityMismatch ? true : snapshot.pending,
    error, recoveryPath, reauthenticationProviders, beginTransition, retryTransition, resetTransition: invalidate,
  }), [beginTransition, error, identityMismatch, invalidate, reauthenticationProviders, recoveryPath, retryTransition, snapshot]);
  return <ByUsSessionContext.Provider value={value}>{children}</ByUsSessionContext.Provider>;
}
