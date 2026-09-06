"use client";

import { usePrivy } from "@privy-io/react-auth";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { FanAppFrame, FanContentContainer } from "@/components/fan-shell/fan-app-shell";
import { FanAction } from "@/components/fan-ui/fan-action";
import {
  kakaoConnectionCallbackResponseSchema,
  kakaoConnectionCallbackSchema,
  kakaoProviderErrorSchema,
  type KakaoConnectionCallback,
} from "../domain/kakao-connection-schema";
import styles from "./kakao-callback-screen.module.css";

type Locale = "ko" | "en";
type QueryResult =
  | { kind: "callback"; value: KakaoConnectionCallback }
  | { kind: "invalid" }
  | { kind: "provider_error" };
type ViewState = "loading" | "success" | "signed_out" | "invalid" | "provider_error" | "token_error" | "owner_changed" | "failed";

const copy = {
  ko: {
    loading: "Kakao 연결을 확인하고 있어요.",
    success: "Kakao 연결이 완료됐어요.",
    signed_out: "로그인 상태를 확인할 수 없어 연결을 완료하지 못했어요.",
    invalid: "연결 정보가 없거나 올바르지 않아요.",
    provider_error: "Kakao 연결이 취소됐어요.",
    token_error: "로그인 확인에 실패해 연결을 완료하지 못했어요.",
    owner_changed: "연결 도중 계정이 변경됐어요. 현재 계정에서 다시 시작해 주세요.",
    failed: "Kakao 연결을 완료하지 못했어요. 설정에서 다시 시도해 주세요.",
    retry: "설정에서 다시 연결하기",
    settings: "설정으로 돌아가기",
  },
  en: {
    loading: "Checking your Kakao connection.",
    success: "Kakao is connected.",
    signed_out: "We couldn't confirm your login, so the connection wasn't completed.",
    invalid: "The connection details are missing or invalid.",
    provider_error: "The Kakao connection was canceled.",
    token_error: "We couldn't confirm your login to complete the connection.",
    owner_changed: "The account changed during connection. Start again with the current account.",
    failed: "We couldn't complete the Kakao connection. Try again from Settings.",
    retry: "Connect again in Settings",
    settings: "Back to Settings",
  },
} as const;

class CallbackFlowError extends Error {
  constructor(readonly reason: "token_error" | "owner_changed" | "failed") { super(reason); }
}

interface CallbackResult { returnPath: string }
interface CallbackFlight {
  ownerId: string;
  promise: Promise<CallbackResult>;
  subscribers: Set<symbol>;
  ownerIsCurrent: () => boolean;
}
interface CallbackSubscription { promise: Promise<CallbackResult>; unsubscribe(): void }
const callbackFlights = new Map<string, CallbackFlight>();

export function parseKakaoCallbackQuery(query: string): QueryResult {
  const params = new URLSearchParams(query);
  const code = params.getAll("code");
  const state = params.getAll("state");
  const error = params.getAll("error");
  if (code.length > 1 || state.length > 1 || error.length > 1) return { kind: "invalid" };
  if (error.length === 1) {
    return kakaoProviderErrorSchema.safeParse(error[0]).success && code.length === 0
      ? { kind: "provider_error" }
      : { kind: "invalid" };
  }
  const parsed = kakaoConnectionCallbackSchema.safeParse({ code: code[0], state: state[0] });
  return parsed.success ? { kind: "callback", value: parsed.data } : { kind: "invalid" };
}

function callbackKey(value: KakaoConnectionCallback) {
  return `${value.state}\u0000${value.code}`;
}

function subscribeCallback(
  value: KakaoConnectionCallback,
  ownerId: string,
  getAccessToken: () => Promise<string | null>,
  ownerIsCurrent: () => boolean,
): CallbackSubscription {
  const key = callbackKey(value);
  let existing = callbackFlights.get(key);
  if (existing) {
    if (existing.ownerId !== ownerId) {
      return { promise: Promise.reject(new CallbackFlowError("owner_changed")), unsubscribe() {} };
    }
  } else {
    let flight!: CallbackFlight;
    const promise = (async () => {
      const token = await getAccessToken();
      if (!token) throw new CallbackFlowError("token_error");
      if (flight.subscribers.size === 0 || !flight.ownerIsCurrent()) {
        throw new CallbackFlowError("owner_changed");
      }
      const response = await fetch("/api/me/connected-accounts/kakao/callback", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(value),
        cache: "no-store",
      });
      if (!response.ok) throw new CallbackFlowError("failed");
      const parsed = kakaoConnectionCallbackResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new CallbackFlowError("failed");
      return parsed.data;
    })();
    flight = { ownerId, promise, subscribers: new Set(), ownerIsCurrent };
    callbackFlights.set(key, flight);
    const forget = () => window.setTimeout(() => {
      if (callbackFlights.get(key) === flight) callbackFlights.delete(key);
    }, 30_000);
    void promise.then(forget, forget);
    existing = flight;
  }
  const subscriber = Symbol("kakao-callback-subscriber");
  existing.subscribers.add(subscriber);
  return {
    promise: existing.promise,
    unsubscribe() { existing?.subscribers.delete(subscriber); },
  };
}

export function KakaoCallbackScreen({ locale }: { locale: Locale }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [callback] = useState(() => parseKakaoCallbackQuery(searchParams.toString()));
  const { ready, authenticated, getAccessToken, user } = usePrivy();
  const ownerId = user?.id ?? null;
  const currentOwner = useRef(ownerId);
  const terminal = useRef(false);
  const [view, setView] = useState<ViewState>("loading");
  const t = copy[locale];
  const settingsHref = `/settings?locale=${locale}`;

  useLayoutEffect(() => {
    currentOwner.current = ownerId;
  }, [ownerId]);

  useLayoutEffect(() => {
    window.history.replaceState(window.history.state, "", "/settings/kakao/callback");
  }, []);

  useEffect(() => {
    if (callback.kind !== "callback") {
      terminal.current = true;
      setView(callback.kind);
      return;
    }
    if (!ready) return;
    if (!authenticated || !ownerId) {
      terminal.current = true;
      setView("signed_out");
      return;
    }
    if (terminal.current) return;
    let subscribed = true;
    setView("loading");
    const subscription = subscribeCallback(
      callback.value,
      ownerId,
      getAccessToken,
      () => currentOwner.current === ownerId,
    );
    void subscription.promise.then((result) => {
      terminal.current = true;
      if (!subscribed) return;
      if (currentOwner.current !== ownerId) {
        setView("owner_changed");
        return;
      }
      setView("success");
      router.replace(result.returnPath as Route);
    }).catch((error: unknown) => {
      terminal.current = true;
      if (!subscribed) return;
      if (currentOwner.current !== ownerId) {
        setView("owner_changed");
        return;
      }
      setView(error instanceof CallbackFlowError ? error.reason : "failed");
    });
    return () => { subscribed = false; subscription.unsubscribe(); };
  }, [authenticated, callback, getAccessToken, ownerId, ready, router]);

  return (
    <FanAppFrame locale={locale} currentPath="/settings" mainId="kakao-callback" className={styles.page}>
      <FanContentContainer as="main" id="kakao-callback" className={styles.main}>
        <section className={styles.card} aria-live="polite">
          {view === "loading" ? <span className={styles.spinner} aria-hidden="true" /> : null}
          <h1>{t[view]}</h1>
          {view !== "loading" && view !== "success" ? (
            <div className={styles.actions}>
              <FanAction href={settingsHref} variant="primary">{view === "provider_error" ? t.settings : t.retry}</FanAction>
            </div>
          ) : null}
        </section>
      </FanContentContainer>
    </FanAppFrame>
  );
}
