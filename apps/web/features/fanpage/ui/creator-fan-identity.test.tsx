import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { APP_LOCALES } from "@/i18n/locales";
import { CreatorFanIdentity } from "./creator-fan-identity";

describe("official creator identity", () => {
  it.each(APP_LOCALES)("keeps artist and fandom marks distinct in %s", locale => {
    const view = render(<CreatorFanIdentity slug="nchive" name="엔카이브" locale={locale} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("NCHIVE엔카이브");
    const fandom = screen.getByRole("link", { name: /SAVE · 세이브/ });
    expect(fandom).toHaveAttribute("href", "https://x.com/nchiveofficial/status/1750805783091229003");
    expect(fandom).toHaveAttribute("rel", "noopener noreferrer");
    expect(view.container.querySelector("svg image")).toHaveAttribute("href", "/images/celebrities/nchive/save-announcement.jpg");
    view.rerender(<CreatorFanIdentity slug="wena" name="위나" locale={locale} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("We;Na위나");
    expect(screen.getByRole("link", { name: /mymean · 마이민/ })).toHaveAttribute("href", "https://www.instagram.com/p/Cgi79qPJVt-/");
    expect(view.container.querySelector("svg image")).toBeNull();
  });

  it("shows verified creator spellings without inventing a fandom", () => {
    const view = render(<CreatorFanIdentity slug="changha" name="창하" locale="ko" />);
    expect(screen.getByRole("heading")).toHaveTextContent("창하CHANGHA");
    expect(view.container.querySelector("dl")).toBeNull();
    view.rerender(<CreatorFanIdentity slug="elina" name="Elina" locale="en" />);
    expect(screen.getByRole("heading")).toHaveTextContent("Elina Karimova엘리나");
    expect(view.container.querySelector("img")).toBeNull();
  });

  it.each(["runmusic", "future-creator", "constructor"])("preserves supplied names for %s", slug => {
    const view = render(<CreatorFanIdentity slug={slug} name="Published name" locale="ko" />);
    expect(screen.getByRole("heading", { name: "Published name" })).toBeInTheDocument();
    expect(view.container.querySelector("dl, img")).toBeNull();
  });
});
