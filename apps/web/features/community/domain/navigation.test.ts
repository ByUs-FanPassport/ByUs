import { describe, expect, it } from "vitest";
import { communityHref, parseCommunityTab, selectCommunityCreator } from "./navigation";

describe("community navigation", () => {
  const creators = [{ slug: "yuna", displayOrder: 1 }, { slug: "elina", displayOrder: 0 }, { slug: "changha", displayOrder: 0 }];
  it("selects a stable published creator and never substitutes an explicit missing creator", () => {
    expect(selectCommunityCreator(creators)?.slug).toBe("changha");
    expect(selectCommunityCreator([...creators].reverse())?.slug).toBe("changha");
    expect(selectCommunityCreator(creators, "elina")?.slug).toBe("elina");
    expect(selectCommunityCreator(creators, "unpublished")).toBeUndefined();
    expect(selectCommunityCreator(creators, "")).toBeUndefined();
    expect(selectCommunityCreator([])).toBeUndefined();
  });
  it("keeps artist, tab and language together and defaults unknown tabs to posts", () => {
    expect(communityHref("elina", "ja", "fans")).toBe("/community?creator=elina&tab=fans&locale=ja");
    expect(parseCommunityTab("certifications")).toBe("certifications");
    expect(parseCommunityTab("requests")).toBe("requests");
    expect(parseCommunityTab("not-a-tab")).toBe("posts");
    expect(parseCommunityTab(undefined)).toBe("posts");
  });
});
