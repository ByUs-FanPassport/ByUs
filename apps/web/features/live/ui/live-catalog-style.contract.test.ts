import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(process.cwd(), "features/live/ui/live-catalog-screen.module.css"),
  "utf8",
);

describe("LIVE catalog repeated action style contract", () => {
  it("uses one consistent Spectrum-outline Secondary treatment", () => {
    const actionRule = css.match(/\.action\s*\{([^}]*)\}/)?.[1];

    expect(actionRule).toBeDefined();
    expect(actionRule).toContain("border:1px solid transparent");
    expect(actionRule).toContain("linear-gradient(#fff,#fff) padding-box");
    expect(actionRule).toContain("var(--color-primary-action) border-box");
    expect(actionRule).toContain("color:var(--color-service-ink)");
    expect(readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8")).toContain("--color-service-ink: oklch(45% 0.22 315)");
  });

  it("preserves the desktop and mobile target contracts", () => {
    expect(css).toMatch(/\.action\s*\{[^}]*width:44px;[^}]*height:44px;/);
    expect(css).toMatch(
      /@media \(min-width:48rem\)[\s\S]*?\.action\s*\{[^}]*min-width:184px;[^}]*min-height:48px;/,
    );
  });
});
