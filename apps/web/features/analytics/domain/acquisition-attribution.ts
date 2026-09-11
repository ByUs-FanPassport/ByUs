import { z } from "zod";

export const acquisitionChannelSchema = z.enum([
  "direct",
  "search",
  "social",
  "email",
  "paid",
  "referral",
  "internal",
]);
export type AcquisitionChannel = z.infer<typeof acquisitionChannelSchema>;

export const acquisitionLandingSchema = z.enum([
  "home",
  "creator_directory",
  "creator",
  "live_directory",
  "live",
  "benefit",
  "fan_guide",
]);
export type AcquisitionLanding = z.infer<typeof acquisitionLandingSchema>;

export const acquisitionTouchSchema = z.object({
  channel: acquisitionChannelSchema,
  landing: acquisitionLandingSchema,
  anonymousRecorded: z.boolean(),
  identifiedRecorded: z.boolean(),
  eventNonce: z.uuid(),
  occurredAt: z.iso.datetime({ offset: true }),
}).strict();
export type AcquisitionTouch = z.infer<typeof acquisitionTouchSchema>;

const SEARCH_HOSTS = new Set([
  "google.com",
  "www.google.com",
  "google.co.kr",
  "www.google.co.kr",
  "bing.com",
  "www.bing.com",
  "search.naver.com",
  "search.daum.net",
]);
const SOCIAL_HOSTS = new Set([
  "instagram.com",
  "www.instagram.com",
  "l.instagram.com",
  "tiktok.com",
  "www.tiktok.com",
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "facebook.com",
  "www.facebook.com",
]);

function normalizedHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

export function acquisitionLanding(pathname: string): AcquisitionLanding | null {
  if (pathname === "/") return "home";
  if (pathname === "/celebrities") return "creator_directory";
  if (/^\/c\/[^/]+\/?$/.test(pathname)) return "creator";
  if (pathname === "/live") return "live_directory";
  if (/^\/live\/[^/]+\/?$/.test(pathname)) return "live";
  if (/^\/benefits\/[^/]+\/?$/.test(pathname)) return "benefit";
  if (/^\/guide\/?$/.test(pathname) || /^\/pages\/(?:elina-fan-guide|ifew-fan-guide|us-fanmeetings)\/?$/.test(pathname)) return "fan_guide";
  return null;
}

function channelFromMedium(medium: string | null): AcquisitionChannel | null {
  switch (medium?.trim().toLowerCase()) {
    case "cpc":
    case "ppc":
    case "paid":
    case "paid_search":
    case "paid_social":
      return "paid";
    case "social":
    case "social_network":
    case "social_media":
      return "social";
    case "email":
      return "email";
    case "organic":
      return "search";
    case "referral":
      return "referral";
    default:
      return null;
  }
}

export function classifyAcquisitionChannel(input: {
  searchParams: Pick<URLSearchParams, "get" | "has">;
  referrer: string;
  siteOrigin: string;
}): AcquisitionChannel {
  const medium = channelFromMedium(input.searchParams.get("utm_medium"));
  if (medium) return medium;
  if (input.searchParams.has("gclid") || input.searchParams.has("msclkid")) return "paid";
  if (input.searchParams.has("fbclid") || input.searchParams.has("ttclid")) return "social";
  if (!input.referrer) return "direct";

  try {
    const referrer = new URL(input.referrer);
    const site = new URL(input.siteOrigin);
    const hostname = normalizedHostname(referrer.hostname);
    if (hostname === normalizedHostname(site.hostname)) return "internal";
    if (SEARCH_HOSTS.has(hostname)) return "search";
    if (SOCIAL_HOSTS.has(hostname)) return "social";
    return "referral";
  } catch {
    return "direct";
  }
}

export function readStoredAcquisitionTouch(value: string | null): AcquisitionTouch | null {
  if (!value) return null;
  try {
    const parsed = acquisitionTouchSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
