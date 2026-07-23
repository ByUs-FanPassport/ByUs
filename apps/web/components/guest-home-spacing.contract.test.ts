import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(process.cwd(), "components/guest-home.module.css"),
  "utf8",
);

function declarationBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  if (!match) throw new Error(`Missing CSS selector: ${selector}`);
  return match[1].replace(/\s+/g, " ");
}

describe("guest home compact icon-only action spacing", () => {
  it("keeps adjacent header and social action targets edge-to-edge", () => {
    expect(declarationBlock(".headerActions")).toMatch(/\bgap:\s*0\b/);
    expect(declarationBlock(".socialLinks")).toMatch(/\bgap:\s*0\b/);
  });

  it("keeps social actions accessible while using 20px brand marks", () => {
    const target = declarationBlock(".socialLink");
    const icon = declarationBlock(".socialLink img");

    expect(target).toMatch(/\bwidth:\s*44px\b/);
    expect(target).toMatch(/\bmin-width:\s*44px\b/);
    expect(target).toMatch(/\bmin-height:\s*44px\b/);
    expect(icon).toMatch(/\bwidth:\s*20px\b/);
    expect(icon).toMatch(/\bheight:\s*20px\b/);
  });

  it("uses two regular-weight metadata rows and disables live animation for reduced motion", () => {
    expect(declarationBlock(".celebrityInfo")).toMatch(/\bgap:\s*4px\b/);
    expect(declarationBlock(".celebrityMetaRow")).toMatch(
      /\bgrid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\b/,
    );
    expect(declarationBlock(".celebrityInfo h3, .celebrityInfo p")).toMatch(
      /\bfont-weight:\s*400\b/,
    );
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.liveDotActive\s*\{\s*animation:\s*none/,
    );
  });

  it("keeps carousel controls touch-safe and removes large sliding motion for reduced motion", () => {
    const controls = declarationBlock(".carouselControls > button");
    expect(controls).toMatch(/\bwidth:\s*44px\b/);
    expect(controls).toMatch(/\bmin-width:\s*44px\b/);
    expect(controls).toMatch(/\bheight:\s*44px\b/);
    expect(declarationBlock(".carouselDots")).toMatch(/\bbottom:\s*-42px\b/);
    expect(declarationBlock(".carouselPrevious")).toMatch(/\bleft:\s*8px\b/);
    expect(declarationBlock(".carouselNext")).toMatch(/\bright:\s*8px\b/);
    expect(declarationBlock(".carouselDot[aria-current=\"true\"] span")).toMatch(
      /\bbackground:\s*var\(--ink\)/,
    );
    expect(declarationBlock(".heroTrack")).toMatch(
      /\btransition:\s*transform\s+240ms\s+cubic-bezier\(\.2,\s*0,\s*0,\s*1\)/,
    );
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.heroCarousel\[data-reduced-motion="true"\]\s+\.heroTrack\s*\{[^}]*transform:\s*none\s*!important/,
    );
    expect(css).toMatch(
      /@media\s*\(min-width:\s*80rem\)[\s\S]*?\.heroContent\s*\{\s*padding:\s*48px\s+48px\s+48px\s+64px/,
    );
  });
});
