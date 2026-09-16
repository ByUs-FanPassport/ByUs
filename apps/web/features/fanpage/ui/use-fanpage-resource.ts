"use client";
import { usePrivy } from "@privy-io/react-auth";
import { useByUsSession } from "@/components/byus-session-provider";
import { useEffect, useRef, useState } from "react";
import { withRequestDeadline } from "@/features/reliability/client/request-deadline";

type State<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; code: string; membershipCount?: number };
/** Public reads may include owner context; a changed owner never sees an old snapshot. */
export function useFanpageResource<T>(url: string | null, parse: (value: unknown) => T, keepPreviousData = false) {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const tokenProvider = useRef(getAccessToken);
  useEffect(() => { tokenProvider.current = getAccessToken; }, [getAccessToken]);
  const session = useByUsSession();
  const sessionReady = ready && session.ready;
  const requestAuthenticated = sessionReady && authenticated;
  const ownerId = requestAuthenticated ? session.ownerId ?? user?.id ?? null : null;
  const [revision, setRevision] = useState(0);
  const ownerKey = `${url}:${sessionReady}:${requestAuthenticated}:${ownerId ?? "guest"}:${session.generation}`;
  const key = `${ownerKey}:${revision}`;
  const [snapshot, setSnapshot] = useState<{ key: string; ownerKey: string; state: State<T>; refreshFailed?: boolean }>();
  useEffect(() => {
    if (!url || !ready) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const { response, body } = await withRequestDeadline(async (signal) => {
          const token = requestAuthenticated ? await tokenProvider.current() : null;
          signal.throwIfAborted();
          if (requestAuthenticated && !token) throw new Error("AUTHENTICATION_REQUIRED");
          const response = await fetch(url, { cache: "no-store", signal, headers: token ? { Authorization: `Bearer ${token}` } : undefined });
          return { response, body: await response.json() };
        }, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setSnapshot(previous => keepPreviousData && response.status >= 500 && previous?.ownerKey === ownerKey && previous.state.status === "ready"
            ? { ...previous, key, refreshFailed: true }
            : { key, ownerKey, state: { status: "error", code: body.error?.code ?? "UNAVAILABLE", membershipCount: body.membershipCount } });
          return;
        }
        setSnapshot({ key, ownerKey, state: { status: "ready", data: parse(body) } });
      } catch {
        if (!controller.signal.aborted) setSnapshot(previous => keepPreviousData && previous?.ownerKey === ownerKey && previous.state.status === "ready"
          ? { ...previous, key, refreshFailed: true }
          : { key, ownerKey, state: { status: "error", code: "UNAVAILABLE" } });
      }
    })();
    return () => controller.abort();
  }, [url, key, ownerKey, ready, requestAuthenticated, parse, keepPreviousData]);
  const hasCurrentData = snapshot?.key === key || (keepPreviousData && snapshot?.ownerKey === ownerKey && snapshot.state.status === "ready");
  return { state: hasCurrentData ? snapshot!.state : { status: "loading" } as State<T>, refreshFailed: snapshot?.ownerKey === ownerKey && snapshot.refreshFailed, retry: () => setRevision((value) => value + 1) };
}
