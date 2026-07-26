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
    expect(declarationBlock(".actionRail h1")).toContain("line-height: 1.14");
    expect(declarationBlock(".scheduleGroup")).toContain("margin-top: 32px");
    expect(declarationBlock(".primaryActionSlot")).toContain("margin-top: 28px");
    expect(declarationBlock(".actionHelper")).toContain("margin: 12px 0 0");
    expect(declarationBlock(".actionHelper")).toContain("font-size: 12px");
    expect(css).not.toMatch(/(?:^|\n)\.brand\s*\{/);
  });

  it("keeps stable schedule columns on desktop and mobile", () => {
    expect(declarationBlock(".schedule div")).toContain(
      "grid-template-columns: 112px minmax(0, 1fr)",
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*767px\)[\s\S]*?\.schedule div\s*\{[\s\S]*?grid-template-columns:\s*92px minmax\(0,\s*1fr\)/,
    );
    expect(declarationBlock(".timeZone")).toContain("font-size: 12px");
  });
});
