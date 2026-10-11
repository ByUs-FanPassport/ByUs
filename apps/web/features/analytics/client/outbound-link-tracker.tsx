"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { decorateOutboundUrl, outboundCampaign, outboundKindSchema, outboundPlacementSchema, outboundTrackingAllowed } from "../domain/outbound-link";
import { recordProductEventV1 } from "./product-event-client";

export function trackOutboundLinks(root: Document, pathname: string) {
  if (!outboundTrackingAllowed(pathname)) return () => {};
  const owned = new Map<HTMLAnchorElement, { original: string; decorated: string }>();
  function decorate(anchor: HTMLAnchorElement) {
    const href = anchor.getAttribute("href");
    if (href === null) return null;
    const previous = owned.get(anchor);
    const original = href === previous?.decorated ? previous.original : href;
    if (anchor.hasAttribute("download") || anchor.closest('[data-outbound-tracking="off"]')) {
      if (href === previous?.decorated) anchor.setAttribute("href", previous.original);
      owned.delete(anchor);
      return null;
    }
    const marker = root.querySelector<HTMLElement>("[data-outbound-campaign]");
    const placement = outboundPlacementSchema.safeParse(anchor.closest<HTMLElement>("[data-outbound-placement]")?.dataset.outboundPlacement);
    const kind = outboundKindSchema.safeParse(anchor.closest<HTMLElement>("[data-outbound-kind]")?.dataset.outboundKind);
    const result = decorateOutboundUrl(original, root.location.origin, {
      campaign: outboundCampaign(pathname, marker?.dataset.outboundCampaign),
      placement: placement.success ? placement.data : anchor.closest("footer") ? "footer" : anchor.closest("header") ? "header" : "content",
      linkKind: kind.success ? kind.data : anchor.hasAttribute("data-platform") ? "social" : "external",
    });
    if (!result) { owned.delete(anchor); return null; }
    owned.set(anchor, { original, decorated: result.href });
    if (href !== result.href) anchor.setAttribute("href", result.href);
    return result;
  }
  const scan = () => root.querySelectorAll<HTMLAnchorElement>("a[href]").forEach(decorate);
  scan();
  const observer = new MutationObserver(scan);
  observer.observe(root.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["href", "download", "data-outbound-campaign", "data-outbound-placement", "data-outbound-kind", "data-outbound-tracking"] });
  function click(event: MouseEvent) {
    if (event.defaultPrevented || (event.type === "auxclick" ? event.button !== 1 : event.button !== 0)) return;
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!anchor) return;
    const result = decorate(anchor);
    if (!result) return;
    try {
      // No awaited identity lookup: keepalive starts before same-tab navigation.
      void recordProductEventV1({ eventName: "outbound_link_click", source: "web.outbound", idempotencyKey: `outbound:${crypto.randomUUID()}`,
        celebrityId: null, liveEventId: null, missionId: null, benefitId: null, properties: result.properties });
    } catch { /* Analytics must never prevent navigation. */ }
  }
  root.addEventListener("click", click);
  root.addEventListener("auxclick", click);
  return () => {
    observer.disconnect();
    root.removeEventListener("click", click);
    root.removeEventListener("auxclick", click);
    for (const [anchor, value] of owned) if (anchor.getAttribute("href") === value.decorated) anchor.setAttribute("href", value.original);
  };
}

export function OutboundLinkTracker() {
  const pathname = usePathname();
  useEffect(() => trackOutboundLinks(document, pathname), [pathname]);
  return null;
}
