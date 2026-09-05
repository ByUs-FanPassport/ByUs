import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = (name: string) => readFileSync(resolve(process.cwd(), `components/${name}.module.css`), "utf8");

describe("normal-flow footer layout", () => {
  it.each(["fan-app-shell", "focus-flow-frame"])("fills short %s pages without overlaying long content", (name) => {
    const styles = css(`fan-shell/${name}`);
    const frame = styles.match(/\.frame\s*\{([^}]+)\}/)?.[1];
    expect(frame).toContain("display: flex");
    expect(frame).toContain("flex-direction: column");
    expect(frame).toContain("box-sizing: border-box");
    expect(frame).toContain("min-height: 100dvh");
    expect(styles).toMatch(/\.frame > \*\s*\{\s*flex-shrink: 0;/);
    expect(styles).toMatch(/\[data-fan-site-footer\]\s*\{\s*margin-top: auto;/);
    expect(css("fan-shell/fan-site-footer")).not.toMatch(/position:\s*(fixed|absolute)/);
  });

  it("retains mobile navigation clearance and standalone login grid", () => {
    expect(css("fan-shell/fan-app-shell")).toContain("padding-bottom: calc(64px + env(safe-area-inset-bottom))");
    expect(css("login-page")).toContain("grid-template-rows: minmax(0, 1fr) auto");
  });
});
