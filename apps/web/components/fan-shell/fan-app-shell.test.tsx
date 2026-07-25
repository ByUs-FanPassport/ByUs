import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  activeFanSection,
  FanAppFrame,
  FanContentContainer,
  fanNavigationItems,
} from "./fan-app-shell";

describe("fan app shell navigation", () => {
  it.each([
    ["/", "home"],
    ["/live", "live"],
    ["/live/kara-byus-live", "live"],
    ["/celebrities", "favorites"],
    ["/c/kara", "favorites"],
    ["/my", "my"],
    ["/passports", "my"],
    ["/benefits", "my"],
    ["/notifications", "my"],
    ["/settings", "my"],
  ])("maps %s to %s", (pathname, expected) => {
    expect(activeFanSection(pathname)).toBe(expected);
  });

  it("uses the same four destinations in Korean and English", () => {
    expect(fanNavigationItems("ko", "/live").map(({ id, href, label, isCurrent }) => ({
      id,
      href,
      label,
      isCurrent,
    }))).toEqual([
      { id: "home", href: "/?locale=ko", label: "HOME", isCurrent: false },
      { id: "live", href: "/live?locale=ko", label: "LIVE", isCurrent: true },
      { id: "favorites", href: "/celebrities?locale=ko", label: "최애", isCurrent: false },
      { id: "my", href: "/my?locale=ko", label: "MY", isCurrent: false },
    ]);
    expect(fanNavigationItems("en", "/").map((item) => item.label)).toEqual([
      "HOME",
      "LIVE",
      "FAVORITES",
      "MY",
    ]);
  });

  it("connects an optional skip link to the screen main landmark", () => {
    render(
      <FanAppFrame locale="ko" mainId="screen-main">
        <main id="screen-main" tabIndex={-1}>화면 본문</main>
      </FanAppFrame>,
    );

    expect(screen.getByRole("link", { name: "본문으로 바로가기" })).toHaveAttribute(
      "href",
      "#screen-main",
    );
    expect(screen.getByRole("main")).toHaveAttribute("id", "screen-main");
    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("main").closest("[data-fan-surface]")).toHaveAttribute(
      "lang",
      "ko",
    );
  });

  it("uses one shared content-container contract for header, main, and footer", () => {
    render(
      <FanAppFrame locale="ko" mainId="screen-main">
        <FanContentContainer as="main" id="screen-main">
          화면 본문
        </FanContentContainer>
      </FanAppFrame>,
    );

    expect(screen.getByRole("banner").firstElementChild).toHaveAttribute(
      "data-fan-content-container",
    );
    expect(screen.getByRole("main")).toHaveAttribute(
      "data-fan-content-container",
    );

    const footerContainers = screen
      .getByRole("contentinfo")
      .querySelectorAll("[data-fan-content-container]");
    expect(footerContainers).toHaveLength(2);
  });
});
