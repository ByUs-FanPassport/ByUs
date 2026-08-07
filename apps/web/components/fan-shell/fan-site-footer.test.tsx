import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FanSiteFooter } from "./fan-site-footer";

const footerCss = readFileSync(
  resolve(process.cwd(), "components/fan-shell/fan-site-footer.module.css"),
  "utf8",
);

describe("FanSiteFooter", () => {
  it("publishes the Korean fan navigation and essential legal links", () => {
    render(<FanSiteFooter locale="ko" />);

    const footer = screen.getByRole("contentinfo");
    const navigation = within(footer).getByRole("navigation", { name: "ByUs 하단 메뉴" });
    expect(within(navigation).getByRole("link", { name: "LIVE" })).toHaveAttribute("href", "/live?locale=ko");
    expect(within(navigation).getByRole("link", { name: "Fan Passport" })).toHaveAttribute("href", "/passports?locale=ko");
    expect(within(navigation).getByRole("link", { name: "개인정보처리방침 열기" })).toHaveAttribute("href", "/privacy?locale=ko");
    expect(within(navigation).getByRole("link", { name: "이용약관 열기" })).toHaveAttribute("href", "/terms?locale=ko");
    expect(within(navigation).getByRole("heading", { name: "소셜" })).toBeInTheDocument();
    const telegram = within(navigation).getByRole("link", { name: "ByUs Telegram 채널 열기, 새 창" });
    expect(telegram).toHaveAttribute("href", "https://t.me/ByUs_giwa");
    expect(telegram).toHaveAttribute("target", "_blank");
    expect(telegram).toHaveAttribute("rel", "noopener noreferrer");
    expect(telegram).not.toHaveTextContent("Telegram");
    expect(telegram.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(telegram.querySelector("path")).toHaveAttribute("fill", "currentColor");
    expect(within(navigation).queryByRole("link", { name: "문의하기" })).not.toBeInTheDocument();
    expect(within(navigation).queryByRole("link", { name: "이미지 출처 열기" })).not.toBeInTheDocument();
    expect(footer).not.toHaveTextContent("biz@sallylab.io");
    expect(within(footer).getByText("© 2026 Sallylab Inc.")).toBeInTheDocument();
    expect(footer).not.toHaveTextContent(/Instagram|LinkedIn|채용/);
  });

  it("preserves the English locale on fan routes", () => {
    render(<FanSiteFooter locale="en" />);

    const navigation = screen.getByRole("navigation", { name: "ByUs footer navigation" });
    expect(within(navigation).getByRole("link", { name: "Favorites" })).toHaveAttribute("href", "/celebrities?locale=en");
    expect(within(navigation).getByRole("link", { name: "Open Privacy Policy" })).toHaveAttribute("href", "/privacy?locale=en");
    expect(within(navigation).getByRole("link", { name: "Open Terms of Use" })).toHaveAttribute("href", "/terms?locale=en");
    expect(within(navigation).getByRole("heading", { name: "Social" })).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: "Open ByUs Telegram channel, new window" })).toHaveAttribute("href", "https://t.me/ByUs_giwa");
    expect(within(navigation).queryByRole("link", { name: "Contact" })).not.toBeInTheDocument();
    expect(within(navigation).queryByRole("link", { name: "Open image credits" })).not.toBeInTheDocument();
  });

  it("uses a compact 4px-based footer rhythm without shrinking link targets", () => {
    const footerRule = footerCss.match(/\.footer\s*\{([^}]*)\}/)?.[1];
    const innerRule = footerCss.match(/\.inner\s*\{([^}]*)\}/)?.[1];
    const headingRule = footerCss.match(/\.navigation h2\s*\{([^}]*)\}/)?.[1];
    const linkRule = footerCss.match(/\.navigation a\s*\{([^}]*)\}/)?.[1];
    const navigationRule = footerCss.match(/\.navigation\s*\{([^}]*)\}/)?.[1];
    const socialLinkRule = footerCss.match(/\.navigation \.socialLink\s*\{([^}]*)\}/)?.[1];
    const socialIconRule = footerCss.match(/\.socialLink svg\s*\{([^}]*)\}/)?.[1];
    const legalRule = footerCss.match(/\.legal\s*\{([^}]*)\}/)?.[1];

    expect(footerRule).toContain("padding: 40px 0 16px");
    expect(innerRule).toContain("gap: 32px");
    expect(headingRule).toContain("margin: 0 0 4px");
    expect(linkRule).toContain("min-height: 44px");
    expect(linkRule).toContain("font-size: 13px");
    expect(linkRule).toContain("line-height: 1.35");
    expect(navigationRule).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(footerCss).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(socialLinkRule).toContain("width: 44px");
    expect(socialLinkRule).toContain("height: 44px");
    expect(socialLinkRule).toContain("justify-content: flex-start");
    expect(socialIconRule).toContain("width: 16px");
    expect(socialIconRule).toContain("height: 16px");
    expect(legalRule).toContain("min-height: 44px");
    expect(legalRule).toContain("margin-top: 24px");
    expect(legalRule).toContain("padding-top: 12px");
  });
});
