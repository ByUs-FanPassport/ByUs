import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PrivacyPage from "./privacy/page";
import TermsPage from "./terms/page";

describe("public legal pages", () => {
  it("publishes the privacy policy with the confirmed operator and contact", () => {
    render(<PrivacyPage />);

    expect(screen.getByRole("heading", { level: 1, name: "개인정보처리방침" })).toBeInTheDocument();
    expect(screen.getByText("시행일: 2026년 7월 25일")).toBeInTheDocument();
    expect(screen.getAllByText(/Sallylab Inc\./).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "biz@sallylab.io" })).toHaveAttribute("href", "mailto:biz@sallylab.io");
    expect(screen.getByText(/Google 및 Privy 인증 식별자/)).toBeInTheDocument();
  });

  it("publishes the terms with Korean governing law and reciprocal navigation", () => {
    render(<TermsPage />);

    expect(screen.getByRole("heading", { level: 1, name: "이용약관" })).toBeInTheDocument();
    expect(screen.getByText(/대한민국 법률에 따라 해석됩니다/)).toBeInTheDocument();
    const legalNavigation = screen.getByRole("navigation", { name: "법적 문서" });
    expect(within(legalNavigation).getByRole("link", { name: "개인정보처리방침" })).toHaveAttribute("href", "/privacy");
    expect(within(legalNavigation).getByRole("link", { name: "이용약관" })).toHaveAttribute("href", "/terms");
  });
});
