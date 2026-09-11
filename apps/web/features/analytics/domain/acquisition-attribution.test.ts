import { describe, expect, it } from "vitest";

import {
  acquisitionLanding,
  classifyAcquisitionChannel,
  readStoredAcquisitionTouch,
} from "./acquisition-attribution";

describe("acquisition attribution", () => {
  it("allows only public acquisition landing shapes and never retains a slug", () => {
    expect(acquisitionLanding("/")).toBe("home");
    expect(acquisitionLanding("/c/elina")).toBe("creator");
    expect(acquisitionLanding("/live/private-live-code")).toBe("live");
    expect(acquisitionLanding("/guide")).toBe("fan_guide");
    expect(acquisitionLanding("/settings/kakao/callback")).toBeNull();
    expect(acquisitionLanding("/login")).toBeNull();
    expect(acquisitionLanding("/admin/dashboard")).toBeNull();
  });

  it("reduces query and referrer inputs to a bounded channel", () => {
    const secretQuery = new URLSearchParams({
      utm_source: "person@example.com",
      utm_campaign: "private-campaign-name",
      utm_medium: "social",
      code: "oauth-secret",
    });
    const channel = classifyAcquisitionChannel({
      searchParams: secretQuery,
      referrer: "https://private.example/path?token=secret",
      siteOrigin: "https://byus.kr",
    });

    expect(channel).toBe("social");
    expect(JSON.stringify({ channel })).not.toMatch(/person@example|private-campaign|oauth-secret|private\.example/);
    expect(classifyAcquisitionChannel({
      searchParams: new URLSearchParams(),
      referrer: "https://www.google.com/search?q=private",
      siteOrigin: "https://byus.kr",
    })).toBe("search");
    expect(classifyAcquisitionChannel({
      searchParams: new URLSearchParams("gclid=do-not-store"),
      referrer: "",
      siteOrigin: "https://byus.kr",
    })).toBe("paid");
  });

  it("fails closed on tampered session storage", () => {
    expect(readStoredAcquisitionTouch("not-json")).toBeNull();
    expect(readStoredAcquisitionTouch(JSON.stringify({
      channel: "person@example.com",
      landing: "/c/private-slug",
      anonymousRecorded: false,
      identifiedRecorded: false,
      eventNonce: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
    }))).toBeNull();
  });
});
