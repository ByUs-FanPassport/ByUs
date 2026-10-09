import { describe, expect, it } from "vitest";
import { boardHref, fanPageHref, parseFanPageTab, resolveBoardSection, resolveBoardSource } from "./board-navigation";
import { APP_LOCALES } from "@/i18n/locales";
import { fanPageNavigationCopy } from "@/i18n/catalogs/features__fanpage__navigation";

describe("fan page board navigation", () => {
  it("maps legacy tabs into the five-item fan page navigation", () => {
    for (const tab of ["community", "notice", "media", "live"]) expect(parseFanPageTab(tab)).toBe("board");
    expect(parseFanPageTab("events")).toBe("events");
    expect(parseFanPageTab("benefits")).toBe("events");
    expect(parseFanPageTab("unknown")).toBe("home");
  });

  it("preserves legacy board destinations and validates new query values", () => {
    expect(resolveBoardSection("media", undefined)).toBe("media");
    expect(resolveBoardSection("board", "live")).toBe("live");
    expect(resolveBoardSection("board", "unknown")).toBe("feed");
    expect(resolveBoardSource("community", undefined)).toBe("fans");
    expect(resolveBoardSource("notice", undefined)).toBe("official");
    expect(resolveBoardSource("board", "official")).toBe("official");
    expect(resolveBoardSource("board", "unknown")).toBe("all");
  });

  it("builds stable canonical board and top-level links", () => {
    expect(boardHref("elina", "ko")).toBe("/elina?tab=board&locale=ko#celebrity-content");
    expect(boardHref("elina", "ja", { source: "fans" })).toBe("/elina?tab=board&source=fans&locale=ja#celebrity-content");
    expect(boardHref("elina", "en", { source: "official", newsFilter: "notice" })).toBe("/elina?tab=board&source=official&locale=en&news=notice#celebrity-content");
    expect(boardHref("elina", "ko", { section: "media", mediaFilter: "videos" })).toBe("/elina?tab=board&section=media&locale=ko&media=videos#celebrity-content");
    expect(fanPageHref("elina", "fr", "events")).toBe("/elina?tab=events&locale=fr#celebrity-content");
  });

  it.each(APP_LOCALES)("has complete navigation copy in %s", (locale) => {
    const labels = fanPageNavigationCopy(locale);
    expect(Object.values(labels.main)).toHaveLength(5);
    expect(Object.values(labels.board)).toHaveLength(3);
    expect([...Object.values(labels.main), ...Object.values(labels.board), labels.boardMenu].every(Boolean)).toBe(true);
  });
});
