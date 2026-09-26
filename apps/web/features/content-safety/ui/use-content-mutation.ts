"use client";
import { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useByUsSession } from "@/components/byus-session-provider";
import { contentCopy } from "@/i18n/catalogs/features__fan_posts__ui";
import type { AppLocale } from "@/i18n/locales";

export function useContentMutation(locale: AppLocale) {
  const auth = usePrivy(), session = useByUsSession(), copy = contentCopy(locale);
  const key = `${auth.ready}:${auth.authenticated}:${session.ownerId ?? auth.user?.id}:${session.generation}`;
  const [state, setState] = useState({ key, busy: false, error: "" });
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); pending.current = null; }, [key]);
  async function request(url: string, method: string, body?: unknown): Promise<unknown | null> {
    if (pending.current || !auth.ready || !auth.authenticated || !session.ready) return null;
    const controller = new AbortController(); pending.current = controller;
    setState({ key, busy: true, error: "" });
    try {
      const token = await auth.getAccessToken(); controller.signal.throwIfAborted();
      if (!token) throw new Error("AUTHENTICATION_REQUIRED");
      const multipart = body instanceof FormData;
      const response = await fetch(url, { method, signal: controller.signal, cache: "no-store",
        headers: { Authorization: `Bearer ${token}`, ...(!multipart && body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body === undefined ? undefined : multipart ? body : JSON.stringify(body) });
      const value = await response.json(); controller.signal.throwIfAborted();
      if (!response.ok) throw new Error(value.error?.code ?? "UNAVAILABLE");
      return value;
    } catch (error) {
      if (!controller.signal.aborted) {
        const code = error instanceof Error ? error.message : "";
        setState({ key, busy: false, error: code === "TRANSLATION_RATE_LIMITED" ? copy.translationLimit
          : code.startsWith("TRANSLATION_") ? copy.translationFailed
          : code === "FAN_WEB_FORBIDDEN" ? copy.memberRequired : code === "FAN_WEB_NOT_FOUND" ? copy.unavailable : copy.failed });
      }
      return null;
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setState(previous => previous.key === key ? { ...previous, busy: false } : previous);
    }
  }
  return { request, busy: state.key === key && state.busy, error: state.key === key ? state.error : "" };
}
