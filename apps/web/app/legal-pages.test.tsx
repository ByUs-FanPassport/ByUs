import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { legalDocuments, resolveLegalLocale } from "@/components/legal-content";
import PrivacyPage, { generateMetadata as generatePrivacyMetadata } from "./privacy/page";
import TermsPage, { generateMetadata as generateTermsMetadata } from "./terms/page";

const searchParams = (locale?: string) => Promise.resolve({ locale });

describe("public legal pages", () => {
  it("publishes the Korean privacy policy with the confirmed operator and contact", async () => {
    render(await PrivacyPage({ searchParams: searchParams("ko") }));

    expect(screen.getByRole("heading", { level: 1, name: "개인정보처리방침" })).toBeInTheDocument();
    expect(screen.getByText("시행일: 2026년 7월 25일")).toBeInTheDocument();
    expect(screen.getAllByText(/Sallylab Inc\./).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "biz@sallylab.io" })).toHaveAttribute("href", "mailto:biz@sallylab.io");
    expect(screen.getByText(/Google 및 Privy 인증 식별자/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "언어 선택, 현재 한국어" })).toHaveAttribute("href", "/privacy?locale=en");
    expect(screen.getByRole("link", { name: "홈으로 돌아가기" })).toHaveAttribute("href", "/?locale=ko");
  });

  it("publishes the English privacy policy and keeps the English shell", async () => {
    const { container } = render(await PrivacyPage({ searchParams: searchParams("en") }));

    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeInTheDocument();
    expect(screen.getByText("Effective date: July 25, 2026")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "1. Personal Information We Process" })).toBeInTheDocument();
    expect(screen.getByText(/Google and Privy authentication identifiers/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose language, currently English" })).toHaveAttribute("href", "/privacy?locale=ko");
    expect(screen.getByRole("link", { name: "Return home" })).toHaveAttribute("href", "/?locale=en");
    expect(container.querySelector("[data-fan-surface]")).toHaveAttribute("lang", "en");
    expect(screen.getByRole("link", { name: "Skip to content" })).toBeInTheDocument();
  });

  it("publishes the terms in both languages with Korean governing law", async () => {
    const { unmount } = render(await TermsPage({ searchParams: searchParams("ko") }));
    expect(screen.getByRole("heading", { level: 1, name: "이용약관" })).toBeInTheDocument();
    expect(screen.getByText(/대한민국 법률에 따라 해석됩니다/)).toBeInTheDocument();
    unmount();

    render(await TermsPage({ searchParams: searchParams("en") }));
    expect(screen.getByRole("heading", { level: 1, name: "Terms of Use" })).toBeInTheDocument();
    expect(screen.getByText(/governed by and construed in accordance with the laws of the Republic of Korea/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose language, currently English" })).toHaveAttribute("href", "/terms?locale=ko");
  });

  it("falls back to Korean for missing and unsupported locales", async () => {
    expect(resolveLegalLocale(undefined)).toBe("ko");
    expect(resolveLegalLocale("fr")).toBe("ko");

    render(await TermsPage({ searchParams: searchParams("fr") }));
    expect(screen.getByRole("heading", { level: 1, name: "이용약관" })).toBeInTheDocument();
  });

  it("localizes legal metadata", async () => {
    await expect(generatePrivacyMetadata({ searchParams: searchParams("en") })).resolves.toMatchObject({
      title: "Privacy Policy | ByUs",
      description: "ByUs Privacy Policy",
    });
    await expect(generateTermsMetadata({ searchParams: searchParams("ko") })).resolves.toMatchObject({
      title: "이용약관 | ByUs",
      description: "ByUs 서비스 이용약관",
    });
  });

  it("keeps Korean and English section contracts aligned", () => {
    expect(legalDocuments.privacy.ko.sections).toHaveLength(legalDocuments.privacy.en.sections.length);
    expect(legalDocuments.terms.ko.sections).toHaveLength(legalDocuments.terms.en.sections.length);
    expect(legalDocuments.privacy.en.sections).toHaveLength(8);
    expect(legalDocuments.terms.en.sections).toHaveLength(9);
  });

  it("preserves English locale in reciprocal legal navigation", async () => {
    render(await TermsPage({ searchParams: searchParams("en") }));

    const legalNavigation = screen.getByRole("navigation", { name: "ByUs footer navigation" });
    expect(within(legalNavigation).getByRole("link", { name: "Open Privacy Policy" })).toHaveAttribute("href", "/privacy?locale=en");
    expect(within(legalNavigation).getByRole("link", { name: "Open Terms of Use" })).toHaveAttribute("href", "/terms?locale=en");
  });
});
