import { describe, expect, it } from "vitest";
import { collectionGroupTitle, groupRecentCollection } from "./recent-collection";
import type { MySummary } from "./my-summary";

const item: MySummary["collection"]["recent"][number] = {
  id: "11111111-1111-4111-8111-111111111111", kind: "stamp", title: "엘리나 Stamp",
  href: "/passports/22222222-2222-4222-8222-222222222222", occurredAt: "2026-09-06T01:30:40Z",
};

describe("recent collection grouping", () => {
  it("groups the same Passport and stamp title within the displayed minute, retaining total count and destination", () => {
    const groups = groupRecentCollection([item, { ...item, id: "another-stamp", occurredAt: "2026-09-06T10:30:10+09:00" }]);
    expect(groups).toEqual([{ item, count: 2 }]);
    expect(collectionGroupTitle(groups[0], "ko")).toBe("엘리나 스탬프 2개");
    expect(collectionGroupTitle(groups[0], "en")).toBe("엘리나 Stamp ×2");
  });

  it("never collapses other destinations, titles, minutes, or individual collectible records", () => {
    const items = [item,
      { ...item, id: "other-passport", href: "/passports/33333333-3333-4333-8333-333333333333" },
      { ...item, id: "other-title", title: "LIVE 출석" },
      { ...item, id: "other-minute", occurredAt: "2026-09-06T01:29:59Z" },
      { ...item, id: "gift-one", kind: "collectible" as const },
      { ...item, id: "gift-two", kind: "collectible" as const },
    ];
    expect(groupRecentCollection(items).map(group => group.item.id)).toEqual(items.map(item => item.id));
    expect(groupRecentCollection(items).every(group => group.count === 1)).toBe(true);
    expect(collectionGroupTitle({ item: items[2], count: 1 }, "ko")).toBe("LIVE 출석");
  });
});
