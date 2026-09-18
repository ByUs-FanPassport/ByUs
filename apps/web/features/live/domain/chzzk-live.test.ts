import { describe, expect, it } from "vitest";

import {
  CHZZK_LIVE_MAX_AGE_MS,
  chzzkLiveObservationSchema,
  parseCanonicalChzzkChannelUrl,
  toChzzkLiveWatchUrl,
} from "./chzzk-live";

const channelId = "0a3f97086cb81d3360c69fdf5d020045";

describe("CHZZK LIVE domain", () => {
  it("accepts only canonical CHZZK channel links and builds a safe LIVE destination", () => {
    expect(parseCanonicalChzzkChannelUrl(`https://chzzk.naver.com/${channelId}`)).toBe(channelId);
    expect(parseCanonicalChzzkChannelUrl(`https://chzzk.naver.com/live/${channelId}`)).toBe(channelId);
    expect(parseCanonicalChzzkChannelUrl(`https://chzzk.naver.com/${channelId}?x=1`)).toBeNull();
    expect(parseCanonicalChzzkChannelUrl(`https://chzzk.naver.com.evil.test/${channelId}`)).toBeNull();
    expect(toChzzkLiveWatchUrl(channelId)).toBe(`https://chzzk.naver.com/live/${channelId}`);
  });

  it("keeps a strict, server-observed live contract with a three-minute freshness limit", () => {
    expect(CHZZK_LIVE_MAX_AGE_MS).toBe(180_000);
    expect(chzzkLiveObservationSchema.parse({
      state: "live", channelId, observedAt: "2026-09-18T00:00:00.000Z", title: "LIVE title",
    })).toEqual({ state: "live", channelId, observedAt: "2026-09-18T00:00:00.000Z", title: "LIVE title" });
    expect(chzzkLiveObservationSchema.safeParse({
      state: "live", channelId, observedAt: "2026-09-18T00:00:00.000Z", title: "LIVE", unexpected: true,
    }).success).toBe(false);
  });
});
