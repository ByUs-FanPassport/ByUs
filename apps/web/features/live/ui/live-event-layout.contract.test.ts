import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "features/live/ui/live-event-screen.module.css"), "utf8");

// Accept compact CSS and merge repeated rules in source order, as the cascade does.
function declarations(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]+)\\}`, "g"));
  return Object.fromEntries([...matches].flatMap(match => match[1].split(";").flatMap(part => {
    const colon = part.indexOf(":");
    return colon < 0 ? [] : [[part.slice(0, colon).trim(), part.slice(colon + 1).trim()]];
  })));
}

describe("LIVE detail information hierarchy contract", () => {
  it("groups schedule and full-width primary with token spacing and a quiet helper", () => {
    expect(declarations(".titleGroup")).toMatchObject({ "margin-top": "var(--space-3)" });
    expect(declarations(".scheduleGroup")).toMatchObject({ "margin-top": "var(--space-5)", "padding-top": "var(--space-4)" });
    expect(declarations(".primaryActionSlot")).toMatchObject({ "margin-top": "var(--space-6)", "padding-top": "var(--space-2)" });
    expect(declarations(".actionHelper")).toMatchObject({ "margin-top": "var(--space-3)", "font-weight": "400", "text-align": "start", "margin-bottom": "0" });
    expect(css).toContain("--fan-action-max-width:100%");
  });

  it("stacks schedule labels and emphasizes event time over the deadline", () => {
    expect(declarations(".schedule")).toMatchObject({ display: "grid", gap: "var(--space-3)" });
    expect(declarations(".schedule > div")).toMatchObject({ display: "grid", gap: "var(--space-1)", "min-width": "0" });
    expect(declarations(".schedule dt")).toMatchObject({ "font-size": "12px", "align-items": "center" });
    expect(declarations(".schedule dd")).toMatchObject({ "font-size": "14px", "font-weight": "600", "overflow-wrap": "anywhere", "font-variant-numeric": "tabular-nums" });
    expect(declarations(".schedule .eventSchedule dd")).toMatchObject({ "font-size": "18px", "font-weight": "750" });
    expect(declarations(".reservationDetails summary")).toMatchObject({ "min-height": "var(--min-target)" });
    expect(declarations(".timeZone")).toMatchObject({ margin: "0", "font-size": "12px" });
  });

  it("keeps the mission arrow aligned with its label at a fixed size", () => {
    expect(declarations(".actionRail > div:has(> .missionLink)")).toMatchObject({ width: "100%", "margin-top": "var(--space-4)", "--fan-action-max-width": "100%" });
    expect(declarations(".missionLink")).toMatchObject({ width: "100%", "min-height": "52px" });
    expect(declarations(".missionLink:disabled")).toMatchObject({ "border-color": "var(--color-line-subtle)", background: "oklch(98% 0 0)", color: "var(--color-muted)", "box-shadow": "none" });
    expect(declarations(".missionLinkContent")).toMatchObject({ display: "flex", "align-items": "center", gap: "var(--space-2)" });
    expect(declarations(".missionLinkContent svg")).toMatchObject({ display: "block", width: "18px", height: "18px", flex: "none" });
  });

  it("aligns the Calendar icon wrapper and label on a stable baseline", () => {
    expect(declarations(".calendarActionIcon")).toMatchObject({ display: "grid", width: "18px", height: "18px", flex: "none", "place-items": "center", "line-height": "0" });
    expect(declarations(".calendarActionLabel")).toMatchObject({ "line-height": "1.2" });
  });

  it("keeps the Fan Code card padded and its notice quiet", () => {
    expect(declarations(".fanCode")).toMatchObject({ padding: "20px" });
    expect(declarations(".fanCodeIntro")).toMatchObject({ "align-items": "flex-start", "justify-content": "space-between" });
    expect(declarations('.attendanceNotice[data-before-live]')).toMatchObject({ color: "var(--color-muted)", "font-size": "12px !important", "font-weight": "550 !important", "line-height": "1.5" });
    expect(css).not.toContain(".fanCode:has([data-before-live]) { padding:");
  });
});
