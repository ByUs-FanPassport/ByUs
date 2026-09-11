"use client";

import { usePrivy } from "@privy-io/react-auth";
import { createContext, useContext, useState, type ReactNode } from "react";
import { z } from "zod";
import { mySummarySchema, type MySummary } from "../../features/my/domain/my-summary";
import type { ContentLocale } from "../../server/content/content-domain";
import { stampTypeSchema } from "../../features/passport/domain/passport-read-model";
import type { PassportStampRecord } from "../../features/passport/ui/passport-stamp-artwork";
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
  creatorVerification(slug: string): { status: "guest" | "loading" | "error" | "ready"; verified?: boolean };
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

function HomeOwnerStateProvider({ locale, children, auth }: { locale: ContentLocale; children: ReactNode; auth: HomeAuth }) {
  const ownerId = auth.user?.id;
  const privateReady = auth.ready && (!auth.authenticated || Boolean(ownerId));
  const ownerAuth = { ready: privateReady, authenticated: auth.authenticated, user: ownerId ? { id: ownerId } : null, getAccessToken: auth.getAccessToken };
  const summaryResource = useOwnedFanResource(auth.authenticated && ownerId ? `/api/me/summary?locale=${locale}&tierStages=1` : null, parseHomeSummary, ownerAuth);
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
  const passportResource = useOwnedFanResource(selectedPassportId ? `/api/passports/${encodeURIComponent(selectedPassportId)}?locale=${locale}&tierStages=1` : null, parseHomePassportPreview, ownerAuth);
  const passportPreview: OwnedState<PassportPreview> = passportResource.state.status === "ready"
    ? { status: "ready", data: passportResource.state.data }
    : passportResource.state.status === "loading" ? { status: "loading" } : { status: "error" };
  const creatorVerification = (slug: string) => {
    if (personalization.status === "auth-loading" || personalization.status === "authenticated-loading") return { status: "loading" as const };
    if (personalization.status === "guest") return { status: "guest" as const };
    if (personalization.status === "authenticated-error") return { status: "error" as const };
    const creator = personalization.summary.creators.find((creator) => creator.celebrity.slug === slug);
    return { status: "ready" as const, verified: Boolean(creator?.passport) };
  };
  const value: HomeOwnerContextValue = {
    personalization,
    retryPersonalization: summaryResource.retry,
    selectedPassportId,
    selectPassport: setRequestedPassportId,
    passportPreview,
    creatorVerification,
  };
  return <HomeOwnerContext.Provider value={value}>{children}</HomeOwnerContext.Provider>;
}

export function HomeOwnerProvider({ locale, children }: { locale: ContentLocale; children: ReactNode }) {
  const auth = usePrivy();
  const ownerKey = !auth.ready ? "auth-loading" : !auth.authenticated ? "guest" : auth.user?.id ?? "owner-loading";
  return <HomeOwnerStateProvider key={ownerKey} locale={locale} auth={auth}>{children}</HomeOwnerStateProvider>;
}

export function useHomeOwner() {
  const value = useContext(HomeOwnerContext);
  if (!value) throw new Error("Home owner context is unavailable");
  return value;
}

export function useOptionalHomeCreatorVerification(slug: string) {
  const value = useContext(HomeOwnerContext);
  return value?.creatorVerification(slug) ?? null;
}
