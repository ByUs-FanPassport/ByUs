import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FanSiteFooter } from "./fan-site-footer";

describe("FanSiteFooter", () => {
  it("publishes the Korean fan navigation and essential legal links", () => {
    render(<FanSiteFooter locale="ko" />);

    const footer = screen.getByRole("contentinfo");
    const navigation = within(footer).getByRole("navigation", { name: "ByUs 하단 메뉴" });
    expect(within(navigation).getByRole("link", { name: "LIVE" })).toHaveAttribute("href", "/live?locale=ko");
    expect(within(navigation).getByRole("link", { name: "Fan Passport" })).toHaveAttribute("href", "/passports?locale=ko");
    expect(within(navigation).getByRole("link", { name: "개인정보처리방침 열기" })).toHaveAttribute("href", "/privacy");
    expect(within(navigation).getByRole("link", { name: "이용약관 열기" })).toHaveAttribute("href", "/terms");
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
    expect(within(navigation).getByRole("link", { name: "Open Privacy Policy" })).toHaveAttribute("href", "/privacy");
    expect(within(navigation).getByRole("link", { name: "Open Terms of Use" })).toHaveAttribute("href", "/terms");
    expect(within(navigation).queryByRole("link", { name: "Contact" })).not.toBeInTheDocument();
    expect(within(navigation).queryByRole("link", { name: "Open image credits" })).not.toBeInTheDocument();
  });
});
