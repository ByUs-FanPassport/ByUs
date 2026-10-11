import { describe, expect, it } from "vitest";
import { clientProductEventV1Schema, productEventV1Schema } from "./product-event";
import { decorateOutboundUrl, outboundCampaign, outboundTrackingAllowed } from "./outbound-link";

const context = { campaign: "runmusic", placement: "fanpage_hero", linkKind: "ticket" } as const;
const origin = "https://byus.kr";
const event = { schemaVersion: 1, eventName: "outbound_link_click", source: "web.outbound", idempotencyKey: "outbound:11111111", anonymousSessionId: "session-11111111", celebrityId: null, liveEventId: null, missionId: null, benefitId: null, occurredAt: "2026-10-11T00:00:00Z", properties: { ...context, destinationHost: "wgrw.raceplan.co.kr" } };

describe("outbound URL attribution", () => {
  it("adds missing defaults without changing query bytes, duplicates, existing UTMs or hash", () => {
    const href = "https://tickets.example/entry?a=a%20b&a=a+b&utm_source=partner&UTM_MEDIUM=email#seat%20A";
    expect(decorateOutboundUrl(href, origin, context)?.href).toBe("https://tickets.example/entry?a=a%20b&a=a+b&utm_source=partner&UTM_MEDIUM=email&utm_campaign=runmusic&utm_content=fanpage_hero.ticket#seat%20A");
    const once = decorateOutboundUrl(href, origin, context)!;
    expect(decorateOutboundUrl(once.href, origin, context)?.href).toBe(once.href);
    expect(once.properties).toEqual({ ...context, destinationHost: "tickets.example" });
  });
  it.each([
    "/celebrities", "#section", "https://www.byus.kr/live", "mailto:contact@example.com", "javascript:alert(1)",
    "https://user:secret@example.com/", "https://example.com:8443/", "https://example.com/file.pdf",
    "https://accounts.google.com/signin", "https://checkout.stripe.com/c/pay/id", "https://example.com/OAuth/authorize",
    "https://example.com/checkout/1", "https://example.com/asset?X-Amz-Signature=secret", "https://example.com/?TOKEN=secret",
    "https://example.com/?redirect_uri=https%3A%2F%2Fbyus.kr", "https://example.com/?code=one-time", "https://example.com/?session_id=private",
    "https://partner.example/#access_token=secret&state=abc", "https://partner.example/#/return?access_token=secret", "https://partner.example/#/oauth/callback",
    "https://partner.example/?accessToken=secret", "https://partner.example/?apiKey=secret", "https://partner.example/#sessionId=private",
  ])("does not mutate internal or sensitive link %s", href => {
    expect(decorateOutboundUrl(href, origin, context)).toBeNull();
  });
  it("uses only a matching published marker or a fixed route for campaign", () => {
    expect(outboundCampaign("/runmusic", "runmusic")).toBe("runmusic");
    expect(outboundCampaign("/my/private-id", "runmusic")).toBe("byus");
    expect(outboundCampaign("/someone-secret")).toBe("byus");
    expect(outboundCampaign("/celebrities")).toBe("celebrities");
    expect(outboundCampaign("/c/runmusic/notices/start", "runmusic")).toBe("runmusic");
    expect(outboundTrackingAllowed("/admin/content")).toBe(false);
    expect(outboundTrackingAllowed("/login")).toBe(false);
    expect(outboundTrackingAllowed("/my/settings")).toBe(false);
  });
});

describe("outbound event trust boundary", () => {
  it("accepts only anonymous strict contextual metadata", () => {
    expect(clientProductEventV1Schema.safeParse(event).success).toBe(true);
    expect(productEventV1Schema.safeParse({ ...event, appUserId: null }).success).toBe(true);
  });
  it.each([
    { source: "untrusted" }, { anonymousSessionId: null },
    { celebrityId: "11111111-1111-4111-8111-111111111111" },
    { properties: { ...event.properties, href: "https://tickets.example/?email=person@example.com" } },
    { properties: { ...event.properties, campaign: "person@example.com" } },
    { properties: { ...event.properties, destinationHost: "example.com/private" } },
    { properties: { ...event.properties, placement: "private-page" } },
    { properties: { ...event.properties, linkKind: "purchase_completed" } },
  ])("rejects identities and arbitrary metadata %#", change => {
    expect(clientProductEventV1Schema.safeParse({ ...event, ...change }).success).toBe(false);
  });
  it("rejects an identified server event", () => {
    expect(productEventV1Schema.safeParse({ ...event, anonymousSessionId: null, appUserId: "11111111-1111-4111-8111-111111111111" }).success).toBe(false);
  });
});
