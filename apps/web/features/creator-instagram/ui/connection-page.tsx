"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Route } from "next";
import { z } from "zod";
import { creatorInstagramAccountSchema, type CreatorInstagramAccount, type CreatorInstagramScreen } from "../domain/connection";
import { ConnectionScreen } from "./connection-screen";

const accountResponse = z.object({ account: creatorInstagramAccountSchema.nullable() });
const statusResponse = z.object({ connections: creatorInstagramAccountSchema.array() });
class ConnectionRequestError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }

export function CreatorInstagramPage({ locale }: { locale: "ko" | "en" }) {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const { push } = useRouter();
  const query = useSearchParams();
  const owner = ready && authenticated ? user?.id ?? null : null;
  const currentOwner = useRef(owner);
  useLayoutEffect(() => { currentOwner.current = owner; }, [owner]);
  const [dataOwner, setDataOwner] = useState<string | null>(null);
  const [screen, setScreen] = useState<CreatorInstagramScreen>("intro");
  const [account, setAccount] = useState<CreatorInstagramAccount | null>(null);
  const [accounts, setAccounts] = useState<CreatorInstagramAccount[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const loading = useRef(false);
  const permissionsReturn = useRef<CreatorInstagramScreen>("intro");
  const [reauth, setReauth] = useState(false);
  const t = useCallback((ko: string, en: string) => locale === "ko" ? ko : en, [locale]);
  const login = useCallback((resume = "start") => {
    const returnTo = `/connect/instagram?locale=${locale}&${resume === "confirm" ? "step=confirm" : "resume=start"}`;
    push(`/login?${new URLSearchParams({ locale, returnTo })}` as Route);
  }, [locale, push]);
  const request = useCallback(async (action: string, body?: object, signal?: AbortSignal) => {
    const actor = currentOwner.current;
    if (!actor) throw new ConnectionRequestError(401, "UNAUTHORIZED");
    const token = await getAccessToken();
    if (!token || currentOwner.current !== actor) throw new ConnectionRequestError(401, "UNAUTHORIZED");
    const response = await fetch(`/api/me/instagram/${action}?locale=${locale}`, {
      method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      const parsed = z.object({ error: z.object({ code: z.string() }) }).safeParse(result);
      throw new ConnectionRequestError(response.status, parsed.success ? parsed.data.error.code : "CONNECTION_FAILED");
    }
    if (currentOwner.current !== actor) throw new ConnectionRequestError(401, "UNAUTHORIZED");
    return result;
  }, [getAccessToken, locale]);
  const showFailure = useCallback((failure: unknown) => {
    if (failure instanceof ConnectionRequestError && failure.status === 401) {
      setAccount(null); setAccounts([]); setDataOwner(currentOwner.current); setScreen("intro"); setReauth(true);
      setError(t("ByUs 로그인이 만료됐어요. 다시 로그인한 뒤 연결을 이어가 주세요.", "Your ByUs session expired. Sign in again to continue."));
    } else if (failure instanceof ConnectionRequestError && failure.status === 409) {
      setError(t("연결 상태가 변경됐어요. 새로고침한 뒤 다시 확인해 주세요.", "The connection changed. Reload this page and try again."));
    } else {
      setError(t("지금은 연결 상태를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.", "We can't check the connection right now. Please try again shortly."));
    }
  }, [t]);
  const start = useCallback(async () => {
    if (!ready || loading.current) return;
    if (!currentOwner.current) { login(); return; }
    const actor = currentOwner.current;
    loading.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const body = z.object({ authorizationUrl: z.string().url() }).parse(await request("start", { locale }));
      const target = new URL(body.authorizationUrl);
      if (target.origin !== "https://www.instagram.com" || !/^\/oauth\/authorize\/?$/.test(target.pathname)) throw new Error("Invalid authorization destination");
      window.location.assign(target.href);
    } catch (failure) { if (actor === currentOwner.current) showFailure(failure); }
    finally { loading.current = false; setBusy(false); }
  }, [ready, login, request, locale, showFailure]);

  const callbackStep = query.get("step");
  const callbackError = query.get("error");
  const resume = query.get("resume");
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setAccount(null); setAccounts([]); setError(""); setNotice(""); setScreen("intro"); setDataOwner(owner); setBusy(false);
    if (!owner) return;
    if (resume === "start") {
      // Remove the continuation marker before navigating away; a back navigation must not auto-start OAuth again.
      window.history.replaceState(null, "", `/connect/instagram?locale=${locale}`);
      void start();
      return;
    }
    if (callbackError === "ACCOUNT_MISMATCH") { setScreen("mismatch"); return; }
    if (callbackError === "CANCELLED") setNotice(t("Instagram 연결을 취소했어요. 다시 연결할 수 있어요.", "Instagram connection was cancelled. You can try again."));
    else if (callbackError) setError(t("Instagram 연결을 완료하지 못했어요. 다시 시도해 주세요.", "Instagram connection did not complete. Please try again."));
    setBusy(true);
    void (async () => {
      try {
        if (callbackStep === "confirm") {
          const body = accountResponse.parse(await request("pending", undefined, controller.signal));
          if (!body.account) throw new ConnectionRequestError(409, "PENDING_EXPIRED");
          if (!controller.signal.aborted) { setAccount(body.account); setScreen("confirm"); }
        } else {
          const body = statusResponse.parse(await request("status", undefined, controller.signal));
          if (!controller.signal.aborted) { setAccounts(body.connections); setAccount(body.connections[0] ?? null); setScreen(body.connections.length ? "manage" : "intro"); }
        }
      } catch (failure) { if (!controller.signal.aborted) showFailure(failure); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    })();
    return () => controller.abort();
  }, [owner, ready, request, callbackStep, callbackError, resume, locale, start, t, showFailure]);

  async function mutate(action: "confirm" | "settings" | "disconnect", body: object) {
    if (loading.current) return;
    const actor = currentOwner.current;
    loading.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = await request(action, body);
      if (actor !== currentOwner.current) return;
      if (action === "disconnect") {
        const outcome = z.object({ disconnected: z.literal(true), remoteRevocation: z.enum(["confirmed", "unconfirmed", "not_needed"]) }).parse(result);
        const remaining = accounts.filter(a => a.celebrityId !== account?.celebrityId);
        setAccounts(remaining); setAccount(remaining[0] ?? null); setScreen(remaining.length ? "manage" : "intro");
        setNotice(outcome.remoteRevocation === "unconfirmed" ? t("ByUs 연결을 해제했어요. Instagram의 앱 및 웹사이트 설정에서도 접근 권한을 해제할 수 있어요.", "Disconnected from ByUs. You can also revoke access in Instagram's Apps and Websites settings.") : t("Instagram 연결을 해제했어요.", "Instagram disconnected."));
      } else {
        const next = accountResponse.parse(result).account;
        setAccount(next);
        if (next) setAccounts(previous => [...previous.filter(a => a.celebrityId !== next.celebrityId), next]);
        setScreen(next ? "manage" : "intro");
        if (action === "settings") setNotice(t("LIVE 자동 표시 설정을 저장했어요.", "LIVE display preference saved."));
      }
      if (action === "confirm") window.history.replaceState(null, "", `/connect/instagram?locale=${locale}`);
    } catch (failure) { if (actor === currentOwner.current) showFailure(failure); }
    finally { loading.current = false; setBusy(false); }
  }
  const sameOwner = dataOwner === owner;
  const visibleAccount = sameOwner ? account : null;
  const visibleScreen = sameOwner ? screen : "intro";
  return <ConnectionScreen locale={locale} screen={visibleScreen} account={visibleAccount} accounts={sameOwner ? accounts : []}
    signedIn={!!owner} busy={!ready || busy} error={sameOwner ? error : ""} notice={sameOwner ? notice : ""}
    onStart={() => { if (!owner || reauth) login(callbackStep === "confirm" ? "confirm" : "start"); else void start(); }}
    onConfirm={() => void mutate("confirm", { action: "confirm" })} onCancel={() => void mutate("confirm", { action: "cancel" })}
    onToggle={() => visibleAccount && void mutate("settings", { celebrityId: visibleAccount.celebrityId, generation: visibleAccount.generation, liveEnabled: !visibleAccount.liveEnabled })}
    onDisconnect={() => visibleAccount && void mutate("disconnect", { celebrityId: visibleAccount.celebrityId, generation: visibleAccount.generation })}
    onScreen={next => { if (next === "permissions") permissionsReturn.current = screen; setScreen(screen === "permissions" && next !== "permissions" ? permissionsReturn.current : next); }} onSelect={id => { setAccount(accounts.find(a => a.celebrityId === id) ?? null); setError(""); setNotice(""); }} />;
}
