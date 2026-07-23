import { z } from "zod";

export const liveLocaleSchema = z.enum(["ko", "en"]);
export type LiveLocale = z.infer<typeof liveLocaleSchema>;

export const effectiveLiveStatusSchema = z.enum([
  "scheduled",
  "live",
  "ended",
  "cancelled",
]);
export type EffectiveLiveStatus = z.infer<typeof effectiveLiveStatusSchema>;

export const livePrimaryActionSchema = z.enum([
  "reservation_upcoming",
  "sign_in_to_reserve",
  "verify_fan",
  "reserve",
  "reserved",
  "watch_live",
  "reservation_closed",
  "live_ended",
  "live_cancelled",
]);
export type LivePrimaryAction = z.infer<typeof livePrimaryActionSchema>;

export const credentialMintStatusSchema = z.enum([
  "queued",
  "processing",
  "retryable",
  "permanent_failure",
  "minted",
]);

const isoTimestamp = z.string().datetime({ offset: true });
const safeAssetUrl = z.string().min(1).refine((value) => {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}, "unsafe asset URL");

export const publicLiveEventSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  effectiveStatus: effectiveLiveStatusSchema,
  startsAt: isoTimestamp,
  endsAt: isoTimestamp,
  reservationOpensAt: isoTimestamp,
  reservationClosesAt: isoTimestamp,
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(1200),
  productContext: z.string().trim().min(1).max(1000),
  heroImage: z.object({ url: safeAssetUrl, alt: z.string().trim().min(1).max(300) }),
  celebrity: z.object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().trim().min(1).max(120),
    image: safeAssetUrl,
  }),
  brand: z.object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().trim().min(1).max(120),
    logo: safeAssetUrl,
    websiteUrl: z.string().url().startsWith("https://").nullable(),
  }),
  watch: z.object({
    available: z.boolean(),
    mode: z.enum(["live", "replay", "unavailable"]).optional(),
    url: z.string().url().startsWith("https://"),
  }),
});

export const liveReservationSummarySchema = z.object({
  id: z.string().uuid(),
  createdAt: isoTimestamp,
  stamp: z.object({
    id: z.string().uuid(),
    businessStatus: z.literal("issued"),
    mintStatus: credentialMintStatusSchema,
  }),
});

export const liveViewerSchema = z.object({
  authenticated: z.boolean(),
  passport: z.enum(["active", "missing"]),
  reservation: liveReservationSummarySchema.nullable(),
});

export const liveEventResponseSchema = z.object({
  live: publicLiveEventSchema,
  viewer: liveViewerSchema,
  primaryAction: livePrimaryActionSchema,
});

export type PublicLiveEvent = z.infer<typeof publicLiveEventSchema>;
export type LiveReservationSummary = z.infer<typeof liveReservationSummarySchema>;
export type LiveViewer = z.infer<typeof liveViewerSchema>;
export type LiveEventResponse = z.infer<typeof liveEventResponseSchema>;

export interface LiveStatusOverride {
  effectiveStatus: EffectiveLiveStatus;
  effectiveFrom: string;
  effectiveUntil: string | null;
  createdAt: string;
}

export function deriveEffectiveLiveStatus(input: {
  sourceStatus: EffectiveLiveStatus;
  startsAt: string;
  endsAt: string;
  overrides: readonly LiveStatusOverride[];
  now: Date;
}): EffectiveLiveStatus {
  if (input.sourceStatus === "cancelled") return "cancelled";

  const now = input.now.getTime();
  const activeOverride = input.overrides
    .filter((override) => {
      const from = Date.parse(override.effectiveFrom);
      const until = override.effectiveUntil ? Date.parse(override.effectiveUntil) : Infinity;
      return Number.isFinite(from) && from <= now && now < until;
    })
    .sort((left, right) => {
      const byEffectiveFrom = Date.parse(right.effectiveFrom) - Date.parse(left.effectiveFrom);
      return byEffectiveFrom || Date.parse(right.createdAt) - Date.parse(left.createdAt);
    })[0];
  if (activeOverride) return activeOverride.effectiveStatus;

  if (now < Date.parse(input.startsAt)) return "scheduled";
  if (now < Date.parse(input.endsAt)) return "live";
  return "ended";
}

export function deriveLivePrimaryAction(input: {
  status: EffectiveLiveStatus;
  reservationOpensAt: string;
  reservationClosesAt: string;
  now: Date;
  viewer: LiveViewer;
}): LivePrimaryAction {
  if (input.status === "cancelled") return "live_cancelled";
  if (input.status === "ended") return "live_ended";
  if (input.status === "live") return "watch_live";
  if (input.viewer.reservation) return "reserved";

  const now = input.now.getTime();
  if (now < Date.parse(input.reservationOpensAt)) return "reservation_upcoming";
  if (now >= Date.parse(input.reservationClosesAt)) return "reservation_closed";
  if (!input.viewer.authenticated) return "sign_in_to_reserve";
  if (input.viewer.passport === "missing") return "verify_fan";
  return "reserve";
}

export function parseLiveLocale(value: string): LiveLocale {
  return liveLocaleSchema.parse(value);
}

export function parseExactYouTubeUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) throw new Error("unsafe YouTube URL");

  const host = url.hostname.toLowerCase();
  if (host === "youtu.be") {
    if (!/^\/[A-Za-z0-9_-]+$/.test(url.pathname)) throw new Error("unsafe YouTube URL");
  } else if (host === "youtube.com" || host === "www.youtube.com") {
    const watchId = url.pathname === "/watch" ? url.searchParams.get("v") : null;
    const pathId = /^\/(?:live|embed)\/([A-Za-z0-9_-]+)$/.exec(url.pathname)?.[1];
    if (!watchId?.match(/^[A-Za-z0-9_-]+$/) && !pathId) throw new Error("unsafe YouTube URL");
  } else {
    throw new Error("unsafe YouTube URL");
  }
  return url.toString();
}

function compactCalendarTimestamp(value: string): string {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function createGoogleCalendarUrl(input: {
  canonicalAppUrl: string;
  liveSlug: string;
  title: string;
  startsAt: string;
  endsAt: string;
  description: string;
}): string {
  const appUrl = new URL(input.canonicalAppUrl);
  if (!(["https:", "http:"].includes(appUrl.protocol)) || appUrl.username || appUrl.password) {
    throw new Error("invalid canonical app URL");
  }
  const liveUrl = new URL(`/live/${input.liveSlug}`, appUrl).toString();
  const calendar = new URL("https://calendar.google.com/calendar/render");
  calendar.searchParams.set("action", "TEMPLATE");
  calendar.searchParams.set("text", input.title);
  calendar.searchParams.set(
    "dates",
    `${compactCalendarTimestamp(input.startsAt)}/${compactCalendarTimestamp(input.endsAt)}`,
  );
  calendar.searchParams.set("details", `${input.description}\n\n${liveUrl}`);
  calendar.searchParams.set("location", liveUrl);
  return calendar.toString();
}
