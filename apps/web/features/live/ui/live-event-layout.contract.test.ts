import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(process.cwd(), "features/live/ui/live-event-screen.module.css"),
  "utf8",
);

function declarationBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
}

describe("LIVE detail information hierarchy contract", () => {
  it("groups title, schedule, Primary, and helper with the approved rhythm", () => {
    expect(declarationBlock(".titleGroup")).toContain("margin-top: 24px");
    expect(declarationBlock(".actionRail h1")).toContain("font-size: 24px");
    expect(declarationBlock(".actionRail h1")).toContain("font-weight: 800");
    expect(declarationBlock(".actionRail h1")).toContain("line-height: 1.2");
    expect(declarationBlock(".scheduleGroup")).toContain("margin-top: 24px");
    expect(declarationBlock(".primaryActionSlot")).toContain("margin-top: 24px");
    expect(declarationBlock(".actionHelper")).toContain("margin: 8px 0 0");
    expect(declarationBlock(".actionHelper")).toContain("font-size: 13px");
    expect(declarationBlock(".actionHelper")).toContain("font-weight: 550");
    expect(css).not.toMatch(/(?:^|\n)\.brand\s*\{/);
  });

  it("keeps stable schedule columns on desktop and mobile", () => {
    expect(declarationBlock(".schedule")).toContain("gap: 16px");
    expect(declarationBlock(".scheduleGroup")).toContain(
      "--schedule-label-width: 112px",
    );
    expect(declarationBlock(".scheduleGroup")).toContain(
      "--schedule-column-gap: 16px",
    );
    expect(declarationBlock(".schedule div")).toContain(
      "grid-template-columns: var(--schedule-label-width) minmax(0, 1fr)",
    );
    expect(declarationBlock(".schedule dt")).toContain("font-size: 14px");
    expect(declarationBlock(".schedule dt")).toContain("font-weight: 550");
    expect(declarationBlock(".schedule dt")).toContain("line-height: 1.5");
    expect(declarationBlock(".schedule dt")).toContain("overflow-wrap: anywhere");
    expect(declarationBlock(".schedule dd")).toContain("font-size: 14px");
    expect(declarationBlock(".schedule dd")).toContain("font-weight: 750");
    expect(declarationBlock(".schedule dd")).toContain("line-height: 1.5");
    expect(declarationBlock(".schedule dd")).toContain("overflow-wrap: anywhere");
    expect(declarationBlock(".schedule dd")).toContain(
      "font-variant-numeric: tabular-nums",
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*767px\)[\s\S]*?\.scheduleGroup\s*\{[\s\S]*?--schedule-label-width:\s*92px[\s\S]*?--schedule-column-gap:\s*12px/,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*767px\)[\s\S]*?\.actionRail h1\s*\{[\s\S]*?font-size:\s*20px/,
    );
    expect(declarationBlock(".timeZone")).toContain(
      "margin-block: 8px 0",
    );
    expect(declarationBlock(".timeZone")).toContain(
      "margin-inline: calc(var(--schedule-label-width) + var(--schedule-column-gap)) 0",
    );
    expect(declarationBlock(".timeZone")).toContain("text-align: start");
    expect(declarationBlock(".timeZone")).toContain("font-size: 13px");
  });
});
