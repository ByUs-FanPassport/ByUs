import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomeEntryCards } from "./home-entry-cards";

describe("home entry cards", () => {
  it.each(["ko", "en"] as const)("makes each complete card one localized link (%s)", (locale) => {
    const { container } = render(<HomeEntryCards locale={locale} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAttribute("href", `/pages/ifew-fan-guide?locale=${locale}`);
    expect(links[1]).toHaveAttribute("href", `/pages/elina-fan-guide?locale=${locale}`);
    expect(links[2]).toHaveAttribute("href", `/pages/us-fanmeetings?locale=${locale}`);
    expect(links[0].querySelector("img")).not.toBeNull();
    expect(links[0].querySelector("strong")).not.toBeNull();
    expect(links[1].querySelector("strong")).not.toBeNull();
    expect(container.querySelector("a a, a button")).toBeNull();
    expect(container.textContent).not.toMatch(/KH|FOR ENTERTAINMENT/);
  });
});
