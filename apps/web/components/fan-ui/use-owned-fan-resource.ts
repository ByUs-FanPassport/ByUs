"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeFanActivityUpdates } from "./fan-activity-updates";

type ResourceState<T> = { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; kind: "auth" | "missing" | "network" };
type OwnerAuth = {
  ready: boolean;
  authenticated: boolean;
  user?: { id: string } | null;
  getAccessToken: () => Promise<string | null>;
};

/** Keep owned views fresh without blanking the page during background reads. */
export function useOwnedFanResource<T>(
  url: string | null,
  parse: (value: unknown) => T,
  auth: OwnerAuth,
  shouldPoll?: (data: T) => boolean,
) {
  const { ready, authenticated, getAccessToken } = auth;
  const ownerId = auth.user?.id;
  const key = `${ready}:${authenticated}:${ownerId ?? ""}:${url ?? ""}`;
  const [snapshot, setSnapshot] = useState<{ key: string; state: ResourceState<T>; refreshFailed: boolean }>();
  const refreshRef = useRef<() => void>(() => {});
  const retry = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    if (!ready || !authenticated || !url) return;
    let active = true;
    let inFlight = false;
    let requestedAgain = false;
    let data: T | undefined;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const publish = (state: ResourceState<T>, refreshFailed = false) => {
      if (active) setSnapshot({ key, state, refreshFailed });
    };
    const load = async () => {
      if (!active) return;
      if (inFlight) { requestedAgain = true; return; }
      clearTimeout(timer);
      inFlight = true;
      controller = new AbortController();
      if (data === undefined) publish({ status: "loading" });
      try {
        const token = await getAccessToken();
        if (!active) return;
        if (!token) { data = undefined; publish({ status: "error", kind: "auth" }); return; }
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
        });
        if (!active) return;
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          data = undefined;
          publish({ status: "error", kind: response.status === 404 ? "missing" : "auth" });
          return;
        }
        if (!response.ok) throw new Error("Owned resource unavailable");
        const next = parse(await response.json());
        if (!active) return;
        data = next;
        failures = 0;
        publish({ status: "ready", data: next });
      } catch {
        if (!active) return;
        failures += 1;
        publish(data === undefined ? { status: "error", kind: "network" } : { status: "ready", data }, data !== undefined);
      } finally {
        inFlight = false;
        if (active && requestedAgain) {
          requestedAgain = false;
          void load();
        } else if (active && data !== undefined && (failures > 0 || shouldPoll?.(data))) {
          timer = setTimeout(() => {
            if (document.visibilityState !== "hidden") void load();
          }, Math.min(5_000 * 2 ** Math.min(failures, 3), 30_000));
        }
      }
    };
    const refresh = () => { void load(); };
    refreshRef.current = refresh;
    const unsubscribe = subscribeFanActivityUpdates(ownerId, refresh);
    void load();
    return () => {
      active = false;
      controller?.abort();
      clearTimeout(timer);
      unsubscribe();
      refreshRef.current = () => {};
    };
  }, [authenticated, getAccessToken, key, ownerId, parse, ready, shouldPoll, url]);

  const state: ResourceState<T> = !ready ? { status: "loading" }
    : !authenticated ? { status: "error", kind: "auth" }
    : !url ? { status: "error", kind: "missing" }
    : snapshot?.key === key ? snapshot.state : { status: "loading" };
  return { state, retry, refreshFailed: snapshot?.key === key && snapshot.refreshFailed };
}
