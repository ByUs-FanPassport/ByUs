import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(process.cwd(), "components/celebrity-directory.module.css"),
  "utf8",
);

function declarationBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  if (!match) throw new Error(`Missing CSS selector: ${selector}`);
  return match[1].replace(/\s+/g, " ");
}

describe("celebrity directory card layout", () => {
  it("uses free card space for LIVE without squeezing medium-width identities", () => {
    const card = declarationBlock(".card");
    const primary = declarationBlock(".cardPrimary");
    const identity = declarationBlock(".cardIdentity");

    expect(card).toMatch(/\bcontainer-type:\s*inline-size\b/);
    expect(primary).toMatch(/\bflex-direction:\s*column\b/);
    expect(identity).toMatch(/\bflex:\s*1\b/);
    expect(identity).toMatch(/\bmin-width:\s*0\b/);
    expect(css).toMatch(
      /@container\s*\(min-width:\s*23rem\)[\s\S]*?\.cardPrimary\s*\{[^}]*flex-direction:\s*row[^}]*align-items:\s*center[^}]*gap:\s*8px\s+12px/,
    );
  });
});
