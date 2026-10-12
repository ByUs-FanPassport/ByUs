import { z } from "zod";

export const outboundCampaignSchema = z.string().max(80).regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/);
export const outboundPlacementSchema = z.enum(["fanpage_hero", "header", "footer", "content"]);
export const outboundKindSchema = z.enum(["ticket", "website", "social", "external"]);
export const outboundPropertiesSchema = z.object({
  destinationHost: z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
  campaign: outboundCampaignSchema,
  placement: outboundPlacementSchema,
  linkKind: outboundKindSchema,
}).strict();
export type OutboundProperties = z.infer<typeof outboundPropertiesSchema>;
export type OutboundContext = Omit<OutboundProperties, "destinationHost">;

export function validateOutboundEvent(event: {
  eventName: string; source: string; appUserId?: string | null; anonymousSessionId: string | null;
  celebrityId: string | null; liveEventId: string | null; missionId: string | null; benefitId: string | null;
  properties: unknown;
}, context: z.RefinementCtx) {
  if (event.eventName !== "outbound_link_click") return;
  if (event.source !== "web.outbound" || event.appUserId != null || !event.anonymousSessionId
    || event.celebrityId !== null || event.liveEventId !== null || event.missionId !== null || event.benefitId !== null
    || !outboundPropertiesSchema.safeParse(event.properties).success) {
    context.addIssue({ code: "custom", message: "Invalid outbound event" });
  }
}

export function outboundTrackingAllowed(pathname: string) {
  return !/^\/(?:admin|api|creator|login|onboarding|settings|connect)(?:\/|$)/.test(pathname)
    && !/^\/my\/(?:settings|security|account|connections)(?:\/|$)/.test(pathname);
}

export function outboundCampaign(pathname: string, publishedSlug?: string) {
  if (publishedSlug && outboundCampaignSchema.safeParse(publishedSlug).success
    && (pathname === `/${publishedSlug}` || pathname.startsWith(`/c/${publishedSlug}/`))) return publishedSlug;
  return ({ "/": "home", "/celebrities": "celebrities", "/community": "community", "/live": "live", "/benefits": "benefits", "/guide": "guide" } as Record<string, string>)[pathname] ?? "kyaa";
}

const sensitiveKey = /^(?:x-amz-|x-goog-|oauth)|(?:token|signature|secret|credential|session|authorization)|(?:^|_)(?:sig|auth|code|state|redirect_uri|redirect_url|key)(?:$|_)|^(?:apiKey|clientKey|redirectUri|redirectUrl)$/i;
const sensitivePath = /(?:^|\/)(?:oauth[^/]*|authorize|authorization|callback|login|signin|sign-in|checkout|payments?|pay|receipt|download)(?:\/|$)/i;
const sensitiveHost = /(?:^|\.)(?:accounts\.google\.com|appleid\.apple\.com|login\.microsoftonline\.com|privy\.io|stripe\.com|paypal\.com|pay\.naver\.com)$/i;

/** Append only: signatures and existing query bytes must never be reserialized. */
export function decorateOutboundUrl(href: string, origin: string, context: OutboundContext) {
  try {
    const url = new URL(href, origin);
    const fragment = url.hash.slice(1);
    const fragmentParams = new URLSearchParams(fragment.includes("?") ? fragment.slice(fragment.indexOf("?") + 1) : fragment);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port
      || url.origin === new URL(origin).origin || /(?:^|\.)(?:byus\.kr|kyaa\.io)$/i.test(url.hostname)
      || sensitiveHost.test(url.hostname) || sensitivePath.test(url.pathname)
      || /\.(?:pdf|zip|csv|xlsx?|docx?|hwpx?|png|jpe?g|webp|gif|mp[34])$/i.test(url.pathname)
      || sensitivePath.test(fragment.split("?")[0])
      || [...url.searchParams.keys(), ...fragmentParams.keys()].some(key => sensitiveKey.test(key))) return null;
    const properties = outboundPropertiesSchema.safeParse({ ...context, destinationHost: url.hostname });
    if (!properties.success) return null;
    const existingKeys = new Set([...url.searchParams.keys()].map(key => key.toLowerCase()));
    const defaults = { utm_source: "kyaa", utm_medium: "referral", utm_campaign: context.campaign, utm_content: `${context.placement}.${context.linkKind}` };
    const additions = Object.entries(defaults).filter(([key]) => !existingKeys.has(key))
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
    const hashAt = href.indexOf("#"), base = hashAt < 0 ? href : href.slice(0, hashAt), hash = hashAt < 0 ? "" : href.slice(hashAt);
    const separator = !base.includes("?") ? "?" : /[?&]$/.test(base) ? "" : "&";
    return { href: additions ? `${base}${separator}${additions}${hash}` : href, properties: properties.data };
  } catch { return null; }
}
