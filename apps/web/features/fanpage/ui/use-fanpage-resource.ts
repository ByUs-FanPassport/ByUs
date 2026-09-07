"use client";
import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useState } from "react";

type State<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; code: string; membershipCount?: number };
/** Public reads may include owner context; a changed owner never sees an old snapshot. */
export function useFanpageResource<T>(url: string | null, parse: (value: unknown) => T) {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const [revision, setRevision] = useState(0);
  const key = `${url}:${ready}:${authenticated}:${user?.id ?? "guest"}:${revision}`;
  const [snapshot, setSnapshot] = useState<{ key: string; state: State<T> }>();
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
        setSnapshot({ key, state: response.ok ? { status: "ready", data: parse(body) } : { status: "error", code: body.error?.code ?? "UNAVAILABLE", membershipCount: body.membershipCount } });
      } catch { if (!controller.signal.aborted) setSnapshot({ key, state: { status: "error", code: "UNAVAILABLE" } }); }
    })();
    return () => controller.abort();
  }, [url, key, ready, authenticated, getAccessToken, parse]);
  return { state: snapshot?.key === key ? snapshot.state : { status: "loading" } as State<T>, retry: () => setRevision((value) => value + 1) };
}
