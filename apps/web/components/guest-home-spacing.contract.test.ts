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
});
