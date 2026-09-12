import { describe, expect, it } from "vitest";
import {
  instagramLiveObservationSchema,
  parseCanonicalInstagramProfileUrl,
  parseInstagramLivePermalink,
} from "./instagram-live";

describe("Instagram LIVE domain", () => {
  it.each([
    ["https://www.instagram.com/MirrorWorld.AI/", "mirrorworld.ai"],
    ["https://instagram.com/test_owner", "test_owner"],
  ])("parses an exact canonical profile URL %s", (value, expected) => {
    expect(parseCanonicalInstagramProfileUrl(value)).toBe(expected);
  });

  it.each([
    "http://www.instagram.com/mirrorworld.ai/",
    "https://www.instagram.com/stories/",
    "https://www.instagram.com/p/",
    "https://www.instagram.com/mirrorworld.ai/live/",
    "https://www.instagram.com/mirrorworld.ai/?next=/other",
    "https://www.instagram.com/mirrorworld.ai/#live",
    "https://user:pass@www.instagram.com/mirrorworld.ai/",
    "https://www.instagram.com:444/mirrorworld.ai/",
    "https://www.instagram.com:443/mirrorworld.ai/",
    "https://www.instagram.com.evil.test/mirrorworld.ai/",
    "https://www.instagram.com/mirrorworld%2eai/",
    "https://www.instagram.com/mirror..world/",
  ])("rejects a non-profile or unsafe profile URL %s", (value) => {
    expect(parseCanonicalInstagramProfileUrl(value)).toBeNull();
  });

  it("accepts only a same-owner numeric stories permalink", () => {
    const permalink = "https://www.instagram.com/stories/mirrorworld.ai/3984542264785618047";
    expect(parseInstagramLivePermalink(permalink, "MIRRORWORLD.AI")).toBe(permalink);
  });

  it.each([
    "https://www.instagram.com/stories/other.owner/3984542264785618047",
    "https://www.instagram.com/p/3984542264785618047/",
    "https://www.instagram.com/reel/3984542264785618047/",
    "https://www.instagram.com/mirrorworld.ai/live/",
    "https://www.instagram.com/stories/mirrorworld.ai/not-digits",
    "https://www.instagram.com/stories/mirrorworld.ai/3984542264785618047?token=secret",
    "https://www.instagram.com:443/stories/mirrorworld.ai/3984542264785618047",
    "https://www.instagram.com.evil.test/stories/mirrorworld.ai/3984542264785618047",
  ])("rejects a spoofed or non-LIVE permalink %s", (value) => {
    expect(parseInstagramLivePermalink(value, "mirrorworld.ai")).toBeNull();
  });

  it("strictly validates the public observation shape", () => {
    const live = {
      state: "live",
      observedAt: "2026-09-12T12:01:40.326Z",
      userId: "17841400000000000",
      username: "mirrorworld.ai",
      mediaId: "18086854778246758",
      actualStartTime: "2026-09-12T12:01:14.000Z",
      permalink: "https://www.instagram.com/stories/mirrorworld.ai/3984542264785618047",
    };
    expect(instagramLiveObservationSchema.parse(live)).toEqual(live);
    expect(instagramLiveObservationSchema.safeParse({ state: "offline", observedAt: live.observedAt }).success).toBe(true);
    expect(instagramLiveObservationSchema.safeParse({ state: "unavailable", observedAt: live.observedAt }).success).toBe(true);
    expect(instagramLiveObservationSchema.safeParse({ ...live, accessToken: "secret" }).success).toBe(false);
    expect(instagramLiveObservationSchema.safeParse({ ...live, permalink: live.permalink.replace("mirrorworld.ai", "other.owner") }).success).toBe(false);
    expect(instagramLiveObservationSchema.safeParse({ state: "offline", observedAt: live.observedAt, mediaId: live.mediaId }).success).toBe(false);
    expect(instagramLiveObservationSchema.safeParse({ ...live, state: "candidate" }).success).toBe(false);
  });
});
