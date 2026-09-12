import { describe, expect, it } from "vitest";
import { parseYouTubeChannelUrl } from "./youtube-channel";
import { parseExternalLiveUrl, parseExactYouTubeUrl } from "./live-event";

describe("YouTube channel opt-in", () => {
  it.each([
    ["https://www.youtube.com/@Creator/", { kind: "handle", value: "creator" }],
    ["https://youtube.com/@%EC%9D%B4%ED%93%A8", { kind: "handle", value: "이퓨" }],
    ["https://youtube.com/channel/UCabcdefghijklmnopqrstuv", { kind: "id", value: "UCabcdefghijklmnopqrstuv" }],
  ])("accepts a canonical channel URL %s", (url, expected) => {
    expect(parseYouTubeChannelUrl(url as string)).toEqual(expected);
    expect(parseExternalLiveUrl("youtube", url as string)).toBe(new URL(url as string).toString());
    expect(() => parseExactYouTubeUrl(url as string)).toThrow();
  });
  it.each([
    "https://youtube.com/watch?v=abcdefghijk", "https://youtube.com/live/abcdefghijk",
    "https://youtube.com/@creator/live", "https://youtube.com/c/creator",
    "http://youtube.com/@creator", "https://youtube.com.evil.test/@creator",
    "https://user@youtube.com/@creator", "https://youtube.com:444/@creator",
    "https://youtube.com/@creator?target=other", "https://youtube.com/@creator#live",
    "https://youtube.com/@a%2fb", "https://youtube.com/@%ZZ", "https://youtube.com/channel/UCshort",
  ])("does not discover from %s", (url) => {
    expect(parseYouTubeChannelUrl(url)).toBeNull();
  });
});
