import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Page, { generateMetadata } from "../../app/pages/us-fanmeetings/page";
import { UsFanmeetingsPage } from "./us-fanmeetings-page";

describe("U.S. fanmeeting inquiries", () => {
  it.each(["ko", "en"] as const)(
    "offers an on-site inquiry dialog and preserves the %s language route",
    (locale) => {
      const { container } = render(<UsFanmeetingsPage locale={locale} />);
      expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
      expect(screen.getByRole("button", { name: locale === "ko" ? "팬미팅 문의하기" : "Discuss your fanmeeting" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "biz@sallylab.io" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: locale === "ko" ? "프로젝트 문의하기" : "Tell us about your project" })).toBeInTheDocument();
      expect(
        screen.getByRole("link", {
          name: locale === "ko" ? "Switch to English" : "한국어로 보기",
        }),
      ).toHaveAttribute(
        "href",
        `/pages/us-fanmeetings?locale=${locale === "ko" ? "en" : "ko"}`,
      );
      expect(
        screen.getByRole("link", {
          name: locale === "ko" ? "지원 범위 보기" : "Explore our support",
        }),
      ).toHaveAttribute("href", "#support");
      expect(container.querySelector("#support")).not.toBeNull();
      expect(container.querySelectorAll("h1")).toHaveLength(1);
      expect(container.querySelector("form")).toBeNull();
      expect(container.querySelector('a[href*="/login"]')).toBeNull();
    },
  );

  it("uses URL locale for the page and its share metadata", async () => {
    const searchParams = Promise.resolve({ locale: "en" });
    render(await Page({ searchParams }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Bring your fanmeeting to the U.S.",
    );
    const metadata = await generateMetadata({ searchParams });
    expect(metadata.title).toContain("Bring your fanmeeting to the U.S.");
    expect(metadata.alternates?.canonical).toBe(
      "https://byus.kr/pages/us-fanmeetings?locale=en",
    );
  });

  it("falls back to Korean for unsupported or repeated locale parameters", async () => {
    for (const locale of ["fr", ["en", "ko"], undefined]) {
      const metadata = await generateMetadata({
        searchParams: Promise.resolve({ locale }),
      });
      expect(metadata.alternates?.canonical).toBe(
        "https://byus.kr/pages/us-fanmeetings?locale=ko",
      );
    }
  });
});
