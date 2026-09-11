"use client";
import { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { subscribeFanActivityUpdates } from "@/components/fan-ui/fan-activity-updates";
import { loungeSchema } from "../domain/lounge";
import type { z } from "zod";

export type LoungeData = z.infer<typeof loungeSchema>;
// The caller keys its component by creator + identity. A history page keeps its
// upper cursor fixed and is re-read, so moderation also reaches old messages.
export function useLounge(slug: string, locale: "ko" | "en", limit = 50, cursor: string | null = null) {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const ownerId = user?.id;
  const requestKey = `${slug}:${locale}:${limit}:${cursor ?? "latest"}:${ready}:${authenticated}:${ownerId ?? "guest"}`;
  const [result, setResult] = useState<{ key: string; data: LoungeData } | null>(null);
  const [failed, setFailed] = useState(false);
  const [latestMessage, setLatestMessage] = useState<LoungeData["messages"][number] | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!ready) return;
    let disposed = false, running = false, queued = false, failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const url = `/api/celebrities/${slug}/lounge?locale=${locale}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    async function refresh() {
      if (disposed) return;
      if (running) { queued = true; return; }
      clearTimeout(timer);
      if (document.visibilityState === "hidden" || !navigator.onLine) return;
      running = true; controller = new AbortController();
      try {
        const token = authenticated ? await getAccessToken() : null;
        if (disposed) return;
        if (authenticated && !token) throw new Error("AUTH_REQUIRED");
        const options = { headers: token ? { Authorization: `Bearer ${token}` } : undefined, signal: controller.signal, cache: "no-store" as const };
        const response = await fetch(url, options);
        if (!response.ok) {
          if (!disposed && response.status < 500 && response.status !== 429) setResult(null);
          throw new Error("LOUNGE_UNAVAILABLE");
        }
        const next = loungeSchema.parse(await response.json());
        let newest = next.messages[0] ?? null;
        if (cursor) {
          const head = await fetch(`/api/celebrities/${slug}/lounge?locale=${locale}&limit=1`, options);
          if (!head.ok) throw new Error("LOUNGE_UNAVAILABLE");
          newest = loungeSchema.parse(await head.json()).messages[0] ?? null;
        }
        if (!disposed) { setResult({ key: requestKey, data: next }); setLatestMessage(newest); setFailed(false); failures = 0; }
      } catch {
        if (!disposed) { setFailed(true); failures++; }
      } finally {
        running = false;
        if (!disposed) {
          if (queued) { queued = false; void refresh(); }
          else timer = setTimeout(() => void refresh(), Math.min(3000 * 2 ** failures, 30000));
        }
      }
    }
    refreshRef.current = () => void refresh();
    const unsubscribe = subscribeFanActivityUpdates(ownerId, refreshRef.current);
    const pause = () => { if (!navigator.onLine || document.visibilityState === "hidden") { clearTimeout(timer); controller?.abort(); } };
    window.addEventListener("offline", pause); document.addEventListener("visibilitychange", pause);
    void refresh();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); unsubscribe(); window.removeEventListener("offline", pause); document.removeEventListener("visibilitychange", pause); };
  }, [slug, locale, limit, cursor, ready, authenticated, ownerId, getAccessToken, requestKey]);
  return { data: result?.key === requestKey ? result.data : null, failed, latestMessage, refresh: () => refreshRef.current() };
}
