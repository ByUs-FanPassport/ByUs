import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

describe("fan typography contract", () => {
  it("keeps Korean words intact only inside opted-in fan surfaces", () => {
    expect(css).toMatch(
      /\[data-fan-surface\]:lang\(ko\)\s*\{[^}]*word-break:\s*keep-all;[^}]*overflow-wrap:\s*break-word;/s,
    );
    expect(css).not.toMatch(/html:lang\(ko\)[^{]*\{/);
    expect(css).not.toMatch(/body:lang\(ko\)[^{]*\{/);
  });

  it("balances headings, prettifies prose, and reserves anywhere wrapping for explicit data", () => {
    expect(css).toMatch(/\[data-fan-surface\]\s+:where\(h1,\s*h2,\s*h3\)\s*\{[^}]*text-wrap:\s*balance;/s);
    expect(css).toMatch(/\[data-fan-surface\]\s+:where\(p,\s*li,\s*blockquote\)\s*\{[^}]*text-wrap:\s*pretty;/s);
    expect(css).toMatch(
      /\[data-fan-surface\]\s+\[data-wrap-anywhere\]\s*\{[^}]*word-break:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s,
    );
  });
});
