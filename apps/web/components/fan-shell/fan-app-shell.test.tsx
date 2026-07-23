import { describe, expect, it } from "vitest";

import { activeFanSection, fanNavigationItems } from "./fan-app-shell";

describe("fan app shell navigation", () => {
  it.each([
    ["/", "home"],
    ["/live", "live"],
    ["/live/kara-byus-live", "live"],
    ["/celebrities", "favorites"],
    ["/c/kara", "favorites"],
    ["/my", "my"],
    ["/passports", "my"],
    ["/benefits", "my"],
    ["/notifications", "my"],
    ["/settings", "my"],
  ])("maps %s to %s", (pathname, expected) => {
    expect(activeFanSection(pathname)).toBe(expected);
  });

  it("uses the same four destinations in Korean and English", () => {
    expect(fanNavigationItems("ko", "/live").map(({ id, href, label, isCurrent }) => ({
      id,
      href,
      label,
      isCurrent,
    }))).toEqual([
      { id: "home", href: "/?locale=ko", label: "HOME", isCurrent: false },
      { id: "live", href: "/live?locale=ko", label: "LIVE", isCurrent: true },
      { id: "favorites", href: "/celebrities?locale=ko", label: "최애", isCurrent: false },
      { id: "my", href: "/my?locale=ko", label: "MY", isCurrent: false },
    ]);
    expect(fanNavigationItems("en", "/").map((item) => item.label)).toEqual([
      "HOME",
      "LIVE",
      "FAVORITES",
      "MY",
    ]);
  });
});
