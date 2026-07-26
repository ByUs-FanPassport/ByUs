import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(process.cwd(), "components/celebrity-fan-page.module.css"),
  "utf8",
);

describe("celebrity home aside layout contract", () => {
  it("keeps the profile and next LIVE cards in one 16px rail", () => {
    const baseAsideRule = css.match(/\.homeAside\s*\{([^}]*)\}/)?.[1];

    expect(baseAsideRule).toContain("display:grid");
    expect(baseAsideRule).toContain("align-content:start");
    expect(baseAsideRule).toContain("gap:16px");
  });

  it("sticks the complete desktop rail instead of the profile card", () => {
    const desktopBlock = css.match(
      /@media \(min-width:64rem\)\s*\{([\s\S]*?)\n\}/,
    )?.[1];

    expect(desktopBlock).toContain(
      ".homeAside { position:sticky; top:148px; align-self:start; }",
    );
    expect(desktopBlock).not.toMatch(/\.profilePanel\s*\{[^}]*position:sticky/);
    expect(css).not.toMatch(/\.profilePanel\s*\{[^}]*position:sticky/);
  });

  it("does not hide overflow or create an internal scroll workaround", () => {
    const asideRules = [...css.matchAll(/\.homeAside\s*\{([^}]*)\}/g)].map(
      ([, declarations]) => declarations,
    );

    expect(asideRules).not.toHaveLength(0);
    for (const declarations of asideRules) {
      expect(declarations).not.toMatch(/overflow\s*:/);
      expect(declarations).not.toMatch(/z-index\s*:/);
    }
  });
});
