"use client";
import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useState } from "react";

type State<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; code: string; membershipCount?: number };
/** Public reads may include owner context; a changed owner never sees an old snapshot. */
export function useFanpageResource<T>(url: string | null, parse: (value: unknown) => T, keepPreviousData = false) {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const [revision, setRevision] = useState(0);
  const ownerKey = `${url}:${ready}:${authenticated}:${user?.id ?? "guest"}`;
  const key = `${ownerKey}:${revision}`;
  const [snapshot, setSnapshot] = useState<{ key: string; ownerKey: string; state: State<T>; refreshFailed?: boolean }>();
  useEffect(() => {
    if (!url || !ready) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const token = authenticated ? await getAccessToken() : null;
        if (controller.signal.aborted) return;
        if (authenticated && !token) throw new Error("AUTHENTICATION_REQUIRED");
        const response = await fetch(url, { cache: "no-store", signal: controller.signal, headers: token ? { Authorization: `Bearer ${token}` } : undefined });
        const body = await response.json();
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
  }, [url, key, ownerKey, ready, authenticated, getAccessToken, parse, keepPreviousData]);
  const hasCurrentData = snapshot?.key === key || (keepPreviousData && snapshot?.ownerKey === ownerKey && snapshot.state.status === "ready");
  return { state: hasCurrentData ? snapshot!.state : { status: "loading" } as State<T>, refreshFailed: snapshot?.ownerKey === ownerKey && snapshot.refreshFailed, retry: () => setRevision((value) => value + 1) };
}
