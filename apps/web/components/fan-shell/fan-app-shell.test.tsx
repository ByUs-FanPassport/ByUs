import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  activeFanSection,
  FanAppFrame,
  FanContentContainer,
  fanNavigationItems,
  localeSwitchHref,
} from "./fan-app-shell";

let pathname = "/";
let search = "";
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
}));

describe("fan app shell navigation", () => {
  beforeEach(() => {
    pathname = "/";
    search = "";
    window.history.replaceState(null, "", "/");
  });

  it.each([
    ["/", "home"],
    ["/live", "live"],
    ["/live/kara-byus-live", "live"],
    ["/celebrities", "favorites"],
    ["/c/kara", "favorites"],
    ["/bias/requests", "favorites"],
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

  it("derives the active destination from the current route on the first render", () => {
    pathname = "/live/kara-byus-live";
    search = "locale=ko";

    render(
      <FanAppFrame locale="ko">
        <main>LIVE 본문</main>
      </FanAppFrame>,
    );

    const currentLinks = screen
      .getAllByRole("link", { name: "LIVE" })
      .filter((link) => link.hasAttribute("aria-current"));
    expect(currentLinks).toHaveLength(2);
    for (const current of currentLinks) {
      expect(current).toHaveAttribute("aria-current", "page");
    }
    expect(screen.getAllByRole("link", { name: "HOME" })[0]).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("changes only locale while preserving route query and hash", () => {
    expect(
      localeSwitchHref(
        "/c/kara",
        "tab=notice&locale=ko&source=home",
        "en",
        "#latest",
      ),
    ).toBe("/c/kara?tab=notice&locale=en&source=home#latest");
  });

  it("retains a nested screen when its selected navigation section is overridden", async () => {
    pathname = "/my/activity";
    search = "kind=collection&locale=ko";
    render(<FanAppFrame locale="ko" currentPath="/my"><main>Activity</main></FanAppFrame>);
    fireEvent.click(screen.getByRole("combobox", { name: "언어 선택, 현재 한국어" }));
    const english = await screen.findByRole("option", { name: "English" });
    fireEvent.pointerDown(english, { button: 0, pointerType: "mouse" });
    fireEvent.click(english);
    expect(push).toHaveBeenCalledWith("/my/activity?kind=collection&locale=en");
  });

  it.each([["ko", "알림"], ["en", "Notifications"], ["ja", "通知"]] as const)("makes notifications reachable from the %s header", (locale, label) => {
    render(<FanAppFrame locale={locale}><main>Content</main></FanAppFrame>);
    expect(within(screen.getByRole("banner")).getByRole("link", { name: label })).toHaveAttribute("href", `/notifications?locale=${locale}`);
  });

  it("preserves non-locale query parameters in the rendered language action", () => {
    pathname = "/c/kara";
    search = "tab=benefits&locale=ko&source=home";

    render(
      <FanAppFrame locale="ko">
        <main>혜택 본문</main>
      </FanAppFrame>,
    );

    const languageAction = screen.getByRole("combobox", { name: "언어 선택, 현재 한국어" });
    expect(languageAction).toHaveValue("ko");
    expect(localeSwitchHref("/c/kara", "tab=benefits&locale=ko&source=home", "ja")).toBe("/c/kara?tab=benefits&locale=ja&source=home");
    expect(languageAction).toHaveAttribute("data-fan-language-action");
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
    expect(footerContainers).toHaveLength(3);
  });
});
