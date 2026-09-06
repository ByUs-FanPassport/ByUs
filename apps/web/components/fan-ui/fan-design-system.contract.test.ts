import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const tokens = read("app/globals.css");
const heading = read("components/fan-ui/fan-heading.module.css");

describe("fan design system ownership", () => {
  it("keeps the approved responsive and control dimensions in the central foundation", () => {
    for (const token of ["--fan-heading-size: 20px", "--fan-heading-size-wide: 24px", "--fan-heading-weight: 850", "--fan-heading-editorial-weight: 800", "--fan-action-primary-height: 48px", "--fan-action-service-height: 52px", "--fan-action-icon-size: 18px"]) expect(tokens).toContain(token);
    expect(heading).toContain("@media (min-width: 40rem)");
    expect(heading).toContain("@media (min-width: 48rem)");
    expect(heading).not.toMatch(/font-size:\s*\d/);
  });
  it("resolves every shared fan variable rather than silently falling back", () => {
    const css = heading + read("components/fan-ui/fan-action.module.css");
    for (const [, variable] of css.matchAll(/var\((--[\w-]+)\)/g)) expect(tokens, variable).toContain(`${variable}:`);
  });
  it("prevents the migrated screen headings from regaining local style ownership", () => {
    const migrated = [
      ["components/guest-home", /\.sectionHeadingRow|\.sectionIntro/],
      ["features/live/ui/live-catalog-screen", /\.groupHeading|\.intro\s+h1/],
      ["features/live/ui/live-calendar-screen", /\.intro\s+h1/],
      ["features/my/ui/my-screen", /\.sectionTitle|\.pageHeading\s+h1/],
    ] as const;
    for (const [path, obsolete] of migrated) {
      const css = read(`${path}.module.css`);
      // The approved desktop calendar artwork has its own display title.
      // Its mobile heading remains owned by the shared FanHeading component.
      if (path === "features/live/ui/live-calendar-screen") expect(css.indexOf("@media (min-width:64rem)")).toBeGreaterThan(0);
      const sharedHeadingCss = path === "features/live/ui/live-calendar-screen"
        ? css.slice(0, css.indexOf("@media (min-width:64rem)"))
        : css;
      expect(sharedHeadingCss, path).not.toMatch(obsolete);
      expect(read(`${path}.tsx`), path).toMatch(/import \{[^}]*Fan(?:Heading|SectionHeader)/);
    }
  });
  it("keeps headings variant-controlled rather than exposing arbitrary style overrides", () => {
    const component = read("components/fan-ui/fan-heading.tsx");
    expect(component).not.toMatch(/(?:className|style)\?:/);
    expect(component).toContain('"personal-page"');
  });
});
