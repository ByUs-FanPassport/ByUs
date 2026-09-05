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
const homeCss = readFileSync(
  resolve(process.cwd(), "components/guest-home.module.css"),
  "utf8",
);
const celebrityCss = readFileSync(
  resolve(process.cwd(), "components/celebrity-fan-page.module.css"),
  "utf8",
);
const designContract = readFileSync(
  resolve(process.cwd(), "../../DESIGN.md"),
  "utf8",
);

describe("shared fan action style contract", () => {
  it("keeps Passport actions distinct from Google service typography", () => {
    const passportRule = actionCss.match(/\.passport\s*\{([\s\S]*?)\n\}/)?.[1];
    const serviceRule = actionCss.match(/\.service\s*\{([\s\S]*?)\n\}/)?.[1];

    expect(passportRule).toContain("min-height: var(--fan-action-service-height)");
    expect(passportRule).toContain("border-radius: var(--radius-pill)");
    expect(passportRule).toContain("linear-gradient(#fff, #fff) padding-box");
    expect(passportRule).toContain("color: var(--color-service-ink)");
    expect(passportRule).toContain('"Pretendard Variable"');
    expect(passportRule).not.toContain('"Google Sans"');
    expect(serviceRule).toContain('"Google Sans"');
  });

  it("constrains direct SVG marks inside action links", () => {
    const directIconRule = actionCss.match(/\.action\s*>\s*svg\s*\{([\s\S]*?)\n\}/)?.[1];

    expect(directIconRule).toContain("width: var(--fan-action-icon-size)");
    expect(directIconRule).toContain("height: var(--fan-action-icon-size)");
    expect(directIconRule).toContain("flex: none");
  });

  it("keeps the shell anchor reset weaker than action classes", () => {
    expect(shellCss).toContain(":where(.frame) a { color: inherit;");
    expect(shellCss).not.toMatch(/(?:^|\n)\.frame a\s*\{/);
  });

  it("uses the 48px product Primary while preserving service and Passport heights", () => {
    const primaryRule = actionCss.match(/\.primary\s*\{([\s\S]*?)\n\}/)?.[1];
    const passportRule = actionCss.match(/\.passport\s*\{([\s\S]*?)\n\}/)?.[1];
    const serviceRule = actionCss.match(/\.service\s*\{([\s\S]*?)\n\}/)?.[1];
    const homePrimaryRule = homeCss.match(/\.primaryButton\s*\{([\s\S]*?)\n\}/)?.[1];
    const celebrityPrimaryRule = celebrityCss.match(/\.heroAction\s*>\s*a\s*\{([\s\S]*?)\n\}/)?.[1];

    expect(primaryRule).toContain("min-height: var(--fan-action-primary-height)");
    expect(homePrimaryRule).toMatch(/min-height:\s*48px/);
    expect(celebrityPrimaryRule).toMatch(/min-height:\s*48px/);
    expect(serviceRule).toContain("min-height: var(--fan-action-service-height)");
    expect(passportRule).toContain("min-height: var(--fan-action-service-height)");
    expect(designContract).toContain("48px minimum height");
    expect(designContract).toContain("Google login: 90% of card width, 52px minimum height");
    expect(designContract).toContain("Passport CTA:");
    expect(designContract).toContain("90% of card width, 52px minimum height");
  });
});
