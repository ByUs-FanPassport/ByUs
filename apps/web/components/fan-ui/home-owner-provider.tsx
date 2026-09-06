"use client";

import { usePrivy } from "@privy-io/react-auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { mySummarySchema, type MySummary } from "../../features/my/domain/my-summary";
import { parseCompleteCreatorReactionBatch } from "../../features/reaction/domain/creator-reaction-batch";
import type { ContentLocale } from "../../server/content/content-domain";
import { stampTypeSchema } from "../../features/passport/domain/passport-read-model";
import type { PassportStampRecord } from "../../features/passport/ui/passport-stamp-artwork";
import { subscribeFanActivityUpdates } from "./fan-activity-updates";
import { useOwnedFanResource } from "./use-owned-fan-resource";

type OwnedState<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error" };
type PersonalizationState = { status: "auth-loading" } | { status: "guest" } | { status: "authenticated-loading" }
  | { status: "authenticated-error" } | { status: "authenticated-ready"; summary: MySummary };
type PassportPreview = { stamps: readonly PassportStampRecord[]; totalCount: number };

type HomeOwnerContextValue = {
  personalization: PersonalizationState;
  retryPersonalization(): void;
  selectedPassportId: string | null;
  selectPassport(id: string): void;
  passportPreview: OwnedState<PassportPreview>;
  creatorReaction(slug: string): { status: "guest" | "loading" | "error" | "ready"; reacted?: boolean };
};

const HomeOwnerContext = createContext<HomeOwnerContextValue | null>(null);

const passportPreviewResponseSchema = z.object({
  passport: z.object({
    stamps: z.array(z.object({ id: z.uuid(), type: stampTypeSchema, issuedAt: z.iso.datetime({ offset: true }) }).loose()),
    activities: z.array(z.object({ stampId: z.uuid().nullable(), points: z.number().int() }).loose()),
    stampSummary: z.object({ total: z.number().int().nonnegative() }).loose(),
  }).loose(),
}).loose();

const parseHomeSummary = (body: unknown) => mySummarySchema.parse((body as { summary?: unknown }).summary);
const parseHomePassportPreview = (body: unknown): PassportPreview => {
  const parsed = passportPreviewResponseSchema.parse(body);
  const pointsByStamp = new Map(parsed.passport.activities.flatMap((activity) => activity.stampId ? [[activity.stampId, activity.points] as const] : []));
  return { stamps: parsed.passport.stamps.map((stamp) => ({ ...stamp, points: pointsByStamp.get(stamp.id) })), totalCount: parsed.passport.stampSummary.total };
};

type HomeAuth = ReturnType<typeof usePrivy>;

function useCreatorReactionBatch(slugs: readonly string[], auth: HomeAuth): OwnedState<ReadonlyMap<string, boolean>> {
  const slugKey = [...new Set(slugs)].join(",");
  const requestedSlugs = useMemo(() => slugKey ? slugKey.split(",") : [], [slugKey]);
  const ownerId = auth.user?.id;
  const key = `${auth.ready}:${auth.authenticated}:${ownerId ?? ""}:${slugKey}`;
  const [snapshot, setSnapshot] = useState<{ key: string; state: OwnedState<ReadonlyMap<string, boolean>> }>();

  useEffect(() => {
    if (!auth.ready || !auth.authenticated || !ownerId || requestedSlugs.length === 0) return;
    let active = true;
    let inFlight = false;
    let requestedAgain = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let data = snapshot?.key === key && snapshot.state.status === "ready" ? snapshot.state.data : undefined;
    const load = async () => {
      if (!active) return;
      if (inFlight) { requestedAgain = true; return; }
      inFlight = true;
      controller = new AbortController();
      if (data === undefined) setSnapshot({ key, state: { status: "loading" } });
      try {
        const token = await auth.getAccessToken();
        if (!active || !token) throw new Error("Authentication unavailable");
        const chunks = Array.from({ length: Math.ceil(requestedSlugs.length / 50) }, (_, index) => requestedSlugs.slice(index * 50, (index + 1) * 50));
        const responses = await Promise.all(chunks.map(async (chunk) => {
          const query = new URLSearchParams({ slugs: chunk.join(",") });
          const response = await fetch(`/api/me/creator-reactions?${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller?.signal });
          if (response.status === 401 || response.status === 403) {
            const error = new Error("Creator reaction authorization unavailable") as Error & { authFailure: boolean };
            error.authFailure = true;
            throw error;
          }
          if (!response.ok) throw new Error("Creator reactions unavailable");
          return parseCompleteCreatorReactionBatch(await response.json(), chunk);
        }));
        data = new Map(responses.flatMap((states) => [...states]));
        if (active) setSnapshot({ key, state: { status: "ready", data } });
      } catch (error) {
        if (!active) return;
        if ((error as { authFailure?: boolean }).authFailure) data = undefined;
        setSnapshot({ key, state: data === undefined ? { status: "error" } : { status: "ready", data } });
      } finally {
        inFlight = false;
        if (active && requestedAgain) { requestedAgain = false; void load(); }
      }
    };
    const scheduleRefresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { void load(); }, 50);
    };
    const unsubscribe = subscribeFanActivityUpdates(ownerId, scheduleRefresh, "reactions");
    void load();
    return () => { active = false; controller?.abort(); clearTimeout(refreshTimer); unsubscribe(); };
    // The snapshot is intentionally excluded: it is output, not a new request identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.authenticated, auth.getAccessToken, auth.ready, key, ownerId, requestedSlugs]);

  if (!auth.ready || (auth.authenticated && (!ownerId || snapshot?.key !== key))) return { status: "loading" };
  if (!auth.authenticated || requestedSlugs.length === 0) return { status: "ready", data: new Map() };
  return snapshot!.state;
}

function HomeOwnerStateProvider({ creatorSlugs, locale, children, auth }: { creatorSlugs: readonly string[]; locale: ContentLocale; children: ReactNode; auth: HomeAuth }) {
  const ownerId = auth.user?.id;
  const privateReady = auth.ready && (!auth.authenticated || Boolean(ownerId));
  const ownerAuth = { ready: privateReady, authenticated: auth.authenticated, user: ownerId ? { id: ownerId } : null, getAccessToken: auth.getAccessToken };
  const summaryResource = useOwnedFanResource(auth.authenticated && ownerId ? `/api/me/summary?locale=${locale}` : null, parseHomeSummary, ownerAuth);
  const personalization: PersonalizationState = !privateReady ? { status: "auth-loading" }
    : !auth.authenticated ? { status: "guest" }
    : summaryResource.state.status === "loading" ? { status: "authenticated-loading" }
    : summaryResource.state.status === "error" ? { status: "authenticated-error" }
    : { status: "authenticated-ready", summary: summaryResource.state.data };
  const passportIds = personalization.status === "authenticated-ready"
    ? personalization.summary.creators.flatMap((creator) => creator.passport ? [creator.passport.id] : [])
    : [];
  const [requestedPassportId, setRequestedPassportId] = useState<string | null>(null);
  const selectedPassportId = requestedPassportId && passportIds.includes(requestedPassportId) ? requestedPassportId : passportIds[0] ?? null;
  const passportResource = useOwnedFanResource(selectedPassportId ? `/api/passports/${encodeURIComponent(selectedPassportId)}?locale=${locale}` : null, parseHomePassportPreview, ownerAuth);
  const passportPreview: OwnedState<PassportPreview> = passportResource.state.status === "ready"
    ? { status: "ready", data: passportResource.state.data }
    : passportResource.state.status === "loading" ? { status: "loading" } : { status: "error" };
  const reactionBatch = useCreatorReactionBatch(creatorSlugs, auth);
  const creatorReaction = useCallback((slug: string) => {
    if (!auth.ready || (auth.authenticated && reactionBatch.status === "loading")) return { status: "loading" as const };
    if (!auth.authenticated) return { status: "guest" as const };
    if (reactionBatch.status !== "ready" || !reactionBatch.data.has(slug)) return { status: "error" as const };
    return { status: "ready" as const, reacted: reactionBatch.data.get(slug)! };
  }, [auth.authenticated, auth.ready, reactionBatch]);
  const value: HomeOwnerContextValue = {
    personalization,
    retryPersonalization: summaryResource.retry,
    selectedPassportId,
    selectPassport: setRequestedPassportId,
    passportPreview,
    creatorReaction,
  };
  return <HomeOwnerContext.Provider value={value}>{children}</HomeOwnerContext.Provider>;
}

export function HomeOwnerProvider({ creatorSlugs, locale, children }: { creatorSlugs: readonly string[]; locale: ContentLocale; children: ReactNode }) {
  const auth = usePrivy();
  const ownerKey = !auth.ready ? "auth-loading" : !auth.authenticated ? "guest" : auth.user?.id ?? "owner-loading";
  return <HomeOwnerStateProvider key={ownerKey} creatorSlugs={creatorSlugs} locale={locale} auth={auth}>{children}</HomeOwnerStateProvider>;
}

export function useHomeOwner() {
  const value = useContext(HomeOwnerContext);
  if (!value) throw new Error("Home owner context is unavailable");
  return value;
}

export function useOptionalHomeCreatorReaction(slug: string) {
  const value = useContext(HomeOwnerContext);
  return value?.creatorReaction(slug) ?? null;
}
