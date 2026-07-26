import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const actionCss = readFileSync(
  resolve(process.cwd(), "components/fan-ui/fan-action.module.css"),
  "utf8",
);
const shellCss = readFileSync(
  resolve(process.cwd(), "components/fan-shell/fan-app-shell.module.css"),
  "utf8",
);

describe("shared fan action style contract", () => {
  it("keeps Passport actions distinct from Google service typography", () => {
    const passportRule = actionCss.match(/\.passport\s*\{([\s\S]*?)\n\}/)?.[1];
    const serviceRule = actionCss.match(/\.service\s*\{([\s\S]*?)\n\}/)?.[1];

    expect(passportRule).toContain("min-height: 52px");
    expect(passportRule).toContain("border-radius: 999rem");
    expect(passportRule).toContain("linear-gradient(#fff, #fff) padding-box");
    expect(passportRule).toContain("color: oklch(45% 0.22 315)");
    expect(passportRule).toContain('"Pretendard Variable"');
    expect(passportRule).not.toContain('"Google Sans"');
    expect(serviceRule).toContain('"Google Sans"');
  });

  it("keeps the shell anchor reset weaker than action classes", () => {
    expect(shellCss).toContain(":where(.frame) a { color: inherit;");
    expect(shellCss).not.toMatch(/(?:^|\n)\.frame a\s*\{/);
  });
});
