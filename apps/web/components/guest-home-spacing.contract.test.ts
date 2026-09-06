import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(process.cwd(), "components/guest-home.module.css"),
  "utf8",
);
const heroCarouselSource = readFileSync(
  resolve(process.cwd(), "components/live-hero-carousel.tsx"),
  "utf8",
);
const liveStatusCss = readFileSync(
  resolve(process.cwd(), "components/live-status-indicator.module.css"),
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

  it("keeps social actions accessible while using quiet 20px brand marks", () => {
    const target = declarationBlock(".socialLink");
    const icon = declarationBlock(".socialLink img");

    expect(target).toMatch(/\bwidth:\s*44px\b/);
    expect(target).toMatch(/\bmin-width:\s*44px\b/);
    expect(target).toMatch(/\bheight:\s*44px\b/);
    expect(target).toMatch(/\bmin-height:\s*44px\b/);
    expect(icon).toMatch(/\bwidth:\s*20px\b/);
    expect(icon).toMatch(/\bheight:\s*20px\b/);
  });

  it("uses two regular-weight metadata rows and disables live animation for reduced motion", () => {
    const info = declarationBlock(".celebrityInfo");
    const metaRow = declarationBlock(".celebrityMetaRow");
    const status = declarationBlock(
      ".celebrityFanLink",
    );
    expect(declarationBlock(".fanCount")).toContain("var(--muted)");

    expect(info).toMatch(/\bgap:\s*4px\b/);
    expect(info).toMatch(/\bpadding:\s*12px\s+12px\s+0\b/);
    expect(metaRow).toMatch(
      /\bgrid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\b/,
    );
    expect(metaRow).toMatch(/\balign-items:\s*center\b/);
    expect(status).toMatch(/\bmin-height:\s*24px\b/);
    expect(status).toMatch(/\bgap:\s*4px\b/);
    expect(declarationBlock(".celebrityInfo h3, .celebrityInfo p")).toMatch(
      /\bfont-weight:\s*400\b/,
    );
    expect(liveStatusCss).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.status\[data-live-status="live"\]\s+\.dot\s*,\s*\.status\[data-live-status="scheduled"\]::after\s*\{[^}]*animation:\s*none/,
    );
  });

  it("keeps the hero status outline visible without adding a filled surface", () => {
    const status = declarationBlock(".liveStatus");

    expect(status).toMatch(
      /\bborder:\s*1px\s+solid\s+rgb\(255\s+95\s+191\s*\/\s*92%\)/,
    );
    expect(status).not.toMatch(/\bbackground(?:-color)?:/);
  });

  it("uses a quieter hierarchy in the signed-in Passport summary", () => {
    expect(declarationBlock(".signedInGreeting h2")).toMatch(
      /\bfont-weight:\s*800\b/,
    );
    expect(declarationBlock(".summarySectionHeader > span")).toMatch(
      /\bfont-weight:\s*650\b/,
    );

    const title = declarationBlock(".ownedPassportLink h3");
    expect(title).toMatch(/\bfont-size:\s*16px\b/);
    expect(title).toMatch(/\bfont-weight:\s*800\b/);

    const value = declarationBlock(".passportValue");
    expect(value).toMatch(/\bfont-size:\s*12px\b/);
    expect(value).toMatch(/\bfont-weight:\s*600\b/);

    expect(declarationBlock(".summaryTextLink")).toMatch(
      /\bfont-weight:\s*650\b/,
    );
  });

  it("keeps carousel controls touch-safe and removes large sliding motion for reduced motion", () => {
    const controls = declarationBlock(".carouselControls > button");
    expect(controls).toMatch(/\bwidth:\s*44px\b/);
    expect(controls).toMatch(/\bmin-width:\s*44px\b/);
    expect(controls).toMatch(/\bheight:\s*44px\b/);
    expect(declarationBlock(".carouselDots")).toMatch(/\bbottom:\s*-42px\b/);
    expect(declarationBlock(".carouselDots")).toMatch(
      /\bwidth:\s*min\(var\(--carousel-width\),\s*100%\)/,
    );
    expect(declarationBlock(".carouselControls .carouselDot")).toMatch(
      /\bmin-width:\s*24px\b/,
    );
    expect(declarationBlock(".carouselPrevious")).toMatch(/\bleft:\s*8px\b/);
    expect(declarationBlock(".carouselNext")).toMatch(/\bright:\s*8px\b/);
    expect(declarationBlock(".carouselDot[aria-current=\"true\"] span")).toMatch(
      /\bbackground:\s*var\(--ink\)/,
    );
    expect(declarationBlock(".carouselDot[aria-current=\"true\"] span")).toMatch(
      /\bwidth:\s*22px\b/,
    );
    expect(declarationBlock(".heroViewport")).toMatch(/\btouch-action:\s*pan-y\s+pinch-zoom/);
    expect(declarationBlock(".heroTrack")).not.toMatch(/\btransition:\s*transform/);
    expect(heroCarouselSource).toContain('useEmblaCarousel({');
    expect(heroCarouselSource).toContain('ref={viewportRef}');
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.heroCarousel\[data-reduced-motion="true"\]\s+\.heroTrack\s*\{[^}]*transform:\s*none\s*!important/,
    );
    expect(css).toMatch(
      /@media\s*\(min-width:\s*80rem\)[\s\S]*?\.heroContent\s*\{\s*padding:\s*48px\s+48px\s+48px\s+64px/,
    );
  });
});
