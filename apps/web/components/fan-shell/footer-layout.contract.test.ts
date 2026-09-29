import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = (name: string) => readFileSync(resolve(process.cwd(), `components/${name}.module.css`), "utf8");

describe("normal-flow footer layout", () => {
  it.each(["fan-app-shell", "focus-flow-frame"])("makes %s the short-page height owner while keeping the footer in normal flow", (name) => {
    const styles = css(`fan-shell/${name}`);
    const frame = styles.match(/\.frame\s*\{([^}]+)\}/)?.[1];
    expect(frame).toContain("display: flex");
    expect(frame).toContain("flex-direction: column");
    expect(frame).toContain("box-sizing: border-box");
    expect(frame).toContain("min-height: 100dvh");
    expect(styles).toMatch(/\.frame > \*\s*\{\s*flex-shrink: 0;/);
    expect(styles).toMatch(/\[data-fan-site-footer\]\s*\{\s*margin-top: auto;/);
    const footer = css("fan-shell/fan-site-footer");
    expect(footer).not.toMatch(/position:\s*(fixed|absolute)/);
    expect(footer).not.toContain("100dvh");
    expect(footer).not.toContain("safe-area-inset-bottom");
  });

  it("assigns mobile navigation and standalone safe-area clearance to their frames", () => {
    expect(css("fan-shell/fan-app-shell")).toContain("padding-bottom: calc(64px + env(safe-area-inset-bottom))");
    expect(css("fan-shell/focus-flow-frame")).toContain("padding-bottom: env(safe-area-inset-bottom)");
    const login = css("login-page");
    expect(login).toContain("min-height: 100dvh");
    expect(login).toContain("grid-template-rows: minmax(0, 1fr) auto");
    expect(login).toContain("max(24px, env(safe-area-inset-bottom))");
  });
});
