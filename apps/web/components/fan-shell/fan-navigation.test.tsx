import "@testing-library/jest-dom/vitest";
import type { Route } from "next";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FanHeader } from "./fan-header";
import {
  FanBottomNavigation,
  FanLocaleLink,
  FanPrimaryNavigation,
  type FanNavigationItem,
} from "./fan-navigation";

const items: readonly FanNavigationItem[] = [
  { id: "home", href: "/", label: "홈" },
  {
    id: "live",
    href: "/live/kara" as Route,
    label: "라이브",
    isCurrent: true,
  },
];

describe("fan navigation primitives", () => {
  it("provides a reusable semantic header frame with the ByUs home link", () => {
    render(
      <FanHeader>
        <span>화면별 도구</span>
      </FanHeader>,
    );

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ByUs 홈" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByText("화면별 도구")).toBeInTheDocument();
  });

  it("exposes exactly one current destination in primary navigation", () => {
    render(<FanPrimaryNavigation ariaLabel="주요 메뉴" items={items} />);

    expect(screen.getByRole("navigation", { name: "주요 메뉴" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "라이브" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "홈" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("keeps bottom-navigation and locale destinations as real links", () => {
    render(
      <>
        <FanBottomNavigation ariaLabel="하단 메뉴" items={items} />
        <FanLocaleLink
          href={"/live/kara?locale=en" as Route}
          hrefLang="en"
          lang="en"
        >
          KO / EN
        </FanLocaleLink>
      </>,
    );

    expect(screen.getByRole("navigation", { name: "하단 메뉴" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "KO / EN" })).toHaveAttribute(
      "href",
      "/live/kara?locale=en",
    );
  });
});
