import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { APP_LOCALES } from "@/i18n/locales";
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
    expect(within(navigation).getByRole("link", { name: "커뮤니티" })).toHaveAttribute("href", "/community?locale=ko");
    expect(within(navigation).getByRole("link", { name: "팬미팅 협업 문의" })).toHaveAttribute("href", "/pages/us-fanmeetings?locale=ko");
    expect(within(navigation).getByRole("link", { name: "이용 가이드" })).toHaveAttribute("href", "/guide?locale=ko");
    expect(within(navigation).getByRole("link", { name: "Fan Passport" })).toHaveAttribute("href", "/passports?locale=ko");
    expect(within(screen.getByRole("contentinfo")).getByRole("link", { name: "개인정보처리방침 열기" })).toHaveAttribute("href", "/privacy?locale=ko");
    expect(within(screen.getByRole("contentinfo")).getByRole("link", { name: "이용약관 열기" })).toHaveAttribute("href", "/terms?locale=ko");
    expect(within(navigation).getByRole("heading", { name: "안내 및 문의" })).toBeInTheDocument();
    expect(within(navigation).queryByRole("link", { name: "개인정보처리방침 열기" })).not.toBeInTheDocument();
    expect(within(navigation).queryByRole("heading", { name: "소셜" })).not.toBeInTheDocument();
    expect(within(footer).getByRole("heading", { name: "소셜" })).toBeInTheDocument();
    const telegram = within(footer).getByRole("link", { name: "ByUs Telegram 채널 열기, 새 창" });
    expect(telegram).toHaveAttribute("href", "https://t.me/ByUs_official");
    expect(telegram).toHaveAttribute("target", "_blank");
    expect(telegram).toHaveAttribute("rel", "noopener noreferrer");
    expect(telegram.textContent).toBe("");
    expect(telegram.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(telegram.querySelector("path")).toHaveAttribute("fill", "currentColor");
    expect(within(navigation).getByRole("link", { name: "문의하기" })).toHaveAttribute("href", "/my/inquiries?locale=ko");
    expect(within(navigation).getByRole("link", { name: "온체인 기록" })).toHaveAttribute("href", "/pages/onchain?locale=ko");
    expect(within(navigation).queryByRole("link", { name: "이미지 출처 열기" })).not.toBeInTheDocument();
    expect(footer).not.toHaveTextContent("biz@sallylab.io");
    expect(within(footer).getByText("© 2026 ByUs. All rights reserved.")).toBeInTheDocument();
    expect(footer).not.toHaveTextContent(/Instagram|LinkedIn|채용/);
  });

  it("preserves the English locale on fan routes", () => {
    render(<FanSiteFooter locale="en" />);

    const navigation = screen.getByRole("navigation", { name: "ByUs footer navigation" });
    expect(within(navigation).getByRole("link", { name: "Community" })).toHaveAttribute("href", "/community?locale=en");
    expect(within(navigation).getByRole("link", { name: "Favorites" })).toHaveAttribute("href", "/celebrities?locale=en");
    expect(within(navigation).getByRole("link", { name: "Fanmeeting partnerships" })).toHaveAttribute("href", "/pages/us-fanmeetings?locale=en");
    expect(within(navigation).getByRole("link", { name: "Service guide" })).toHaveAttribute("href", "/guide?locale=en");
    expect(within(navigation).getByRole("link", { name: "Contact support" })).toHaveAttribute("href", "/my/inquiries?locale=en");
    expect(within(navigation).getByRole("link", { name: "Onchain records" })).toHaveAttribute("href", "/pages/onchain?locale=en");
    expect(within(screen.getByRole("contentinfo")).getByRole("link", { name: "Open Privacy Policy" })).toHaveAttribute("href", "/privacy?locale=en");
    expect(within(screen.getByRole("contentinfo")).getByRole("link", { name: "Open Terms of Use" })).toHaveAttribute("href", "/terms?locale=en");
    expect(within(navigation).getByRole("heading", { name: "Guides & contact" })).toBeInTheDocument();
    expect(within(navigation).queryByRole("link", { name: "Open Privacy Policy" })).not.toBeInTheDocument();
    expect(within(navigation).queryByRole("heading", { name: "Social" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("contentinfo")).getByRole("heading", { name: "Social" })).toBeInTheDocument();
    expect(within(screen.getByRole("contentinfo")).getByRole("link", { name: "Open ByUs Telegram channel, new window" })).toHaveAttribute("href", "https://t.me/ByUs_official");
    expect(within(navigation).queryByRole("link", { name: "Contact" })).not.toBeInTheDocument();
    expect(within(navigation).queryByRole("link", { name: "Open image credits" })).not.toBeInTheDocument();
  });

  it.each(APP_LOCALES)("keeps every service, social, business, and policy group in %s", (locale) => {
    render(<FanSiteFooter locale={locale} />);

    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("navigation").querySelectorAll("section")).toHaveLength(3);
    expect(within(footer).getByRole("navigation").querySelectorAll("a")).toHaveLength(13);
    expect(footer.querySelectorAll('a[target="_blank"]')).toHaveLength(4);
    expect(footer.querySelector(`a[href="/privacy?locale=${locale}"]`)).toBeInTheDocument();
    expect(footer.querySelector("dl")).toBeInTheDocument();
  });

  it("keeps compact responsive groups and accessible controls", () => {
    const linkRule = footerCss.match(/\.navigation a\s*\{([^}]*)\}/)?.[1];
    const navigationRule = footerCss.match(/\.navigation\s*\{([^}]*)\}/)?.[1];
    const serviceGroupRule = footerCss.match(/\.navigation section:last-child\s*\{([^}]*)\}/)?.[1];
    const socialLinkRule = footerCss.match(/\.socialLink\s*\{([^}]*)\}/)?.[1];
    const socialIconRule = footerCss.match(/\.socialLink svg\s*\{([^}]*)\}/)?.[1];

    expect(linkRule).toContain("min-height: 44px");
    expect(linkRule).toContain("font-size: 13px");
    expect(linkRule).toContain("overflow-wrap: anywhere");
    expect(navigationRule).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(serviceGroupRule).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(footerCss).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
    expect(footerCss.match(/\.social\s*\{([^}]*)\}/)?.[1]).toContain("grid-column: 1 / -1");
    expect(footerCss.match(/\.socialLinks\s*\{([^}]*)\}/)?.[1]).toContain("flex-direction: row");
    expect(socialLinkRule).toContain("min-width: 44px");
    expect(socialLinkRule).toContain("height: 44px");
    expect(socialLinkRule).toContain("justify-content: center");
    expect(socialIconRule).toContain("width: 20px");
    expect(socialIconRule).toContain("height: 20px");
    expect(footerCss).not.toContain("safe-area-inset-bottom");
  });

  it("reserves the footer wordmark at its rendered SVG ratio", () => {
    render(<FanSiteFooter locale="ko" />);
    const wordmark = screen.getByRole("img", { name: "ByUs" });
    expect(wordmark).toHaveAttribute("width", "96");
    expect(wordmark).toHaveAttribute("height", "39");
  });
});
