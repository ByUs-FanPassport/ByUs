import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "features/my/ui/my-screen.module.css"), "utf8");

describe("MY creator ticket row style contract", () => {
  it("limits ticket-row spacing to the direct row and centers its nested icon wrapper", () => {
    expect(css).not.toContain(".creator span:last-child { padding-top:");
    expect(css).toContain(".creator > div > span:last-child { padding-top:var(--space-1); }");
    expect(css).toContain(".creator > div > span:last-child > span { display:inline-flex; flex:none; align-items:center; justify-content:center; padding:0; line-height:0; }");
  });
});
