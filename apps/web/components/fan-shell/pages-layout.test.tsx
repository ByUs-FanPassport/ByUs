import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PagesLayout from "@/app/pages/layout";
import { FanParticipationGuide } from "../fan-participation-guide/fan-participation-guide";
import { UsFanmeetingsPage } from "../us-fanmeetings/us-fanmeetings-page";

const navigation = vi.hoisted(() => ({ search: "locale=ko" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

describe("public pages layout", () => {
  it.each([
    ["elina", "ko"], ["elina", "en"],
    ["ifew", "ko"], ["ifew", "en"],
    ["us-fanmeetings", "ko"], ["us-fanmeetings", "en"],
  ] as const)("owns exactly one complete footer for %s (%s)", (page, locale) => {
    navigation.search = `locale=${locale}`;
    render(
      <PagesLayout>
        {page === "us-fanmeetings" ? <UsFanmeetingsPage locale={locale} /> : (
          <FanParticipationGuide creator={page} locale={locale} images={{ celebrity: null, eventPhotos: undefined }} />
        )}
      </PagesLayout>,
    );
    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveAttribute("data-fan-site-footer");
    expect(within(footer).getByRole("link", { name: /Privacy Policy|개인정보처리방침/ })).toHaveAttribute("href", `/privacy?locale=${locale}`);
    expect(within(footer).getByRole("link", { name: /Terms of Use|이용약관/ })).toHaveAttribute("href", `/terms?locale=${locale}`);
    expect(footer).toHaveTextContent("© 2026 ByUs. All rights reserved.");
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("updates a persistent layout's footer after language navigation", () => {
    navigation.search = "locale=ko";
    const { rerender } = render(<PagesLayout><main>Content</main></PagesLayout>);
    expect(screen.getByRole("navigation", { name: "ByUs 하단 메뉴" })).toBeInTheDocument();
    navigation.search = "locale=en";
    rerender(<PagesLayout><main>Content</main></PagesLayout>);
    expect(screen.getByRole("navigation", { name: "ByUs footer navigation" })).toBeInTheDocument();
    expect(screen.getAllByRole("contentinfo")).toHaveLength(1);
  });

  it.each(["", "locale=fr", "locale=en&locale=ko"])("matches the page's Korean fallback for %s", (search) => {
    navigation.search = search;
    render(<PagesLayout><main>Content</main></PagesLayout>);
    expect(screen.getByRole("navigation", { name: "ByUs 하단 메뉴" })).toBeInTheDocument();
  });
});
