import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminOperationsShell } from "./operations-shell";

let pathname = "/admin";
let searchParams = new URLSearchParams();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
  useRouter: () => ({ replace }),
}));

describe("AdminOperationsShell navigation", () => {
  beforeEach(() => {
    pathname = "/admin";
    searchParams = new URLSearchParams();
    replace.mockClear();
  });

  it.each([
    ["/admin", "개요"],
    ["/admin/celebrities", "셀럽 콘텐츠"],
    ["/admin/celebrities/kara/quiz", "셀럽 콘텐츠"],
    ["/admin/lives", "라이브"],
    ["/admin/lives/live-1/survey", "라이브"],
    ["/admin/benefits", "혜택"],
    ["/admin/dashboard", "분석"],
    ["/admin/fans", "팬 운영"],
    ["/admin/blockchain-jobs", "블록체인 작업"],
    ["/admin/audit", "감사 로그"],
  ])("marks the owning navigation item current at %s", (route, label) => {
    pathname = route;
    render(<AdminOperationsShell locale="ko"><p>content</p></AdminOperationsShell>);
    const desktopNavigation = screen.getAllByRole("navigation", { name: "관리자 메뉴" })[0];
    expect(within(desktopNavigation).getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    expect(within(desktopNavigation).getAllByRole("link").filter((link) => link.hasAttribute("aria-current"))).toHaveLength(1);
  });

  it("keeps the analytics item current for both dashboard query views", () => {
    pathname = "/admin/dashboard";
    searchParams = new URLSearchParams("view=brand");
    render(<AdminOperationsShell locale="ko"><p>content</p></AdminOperationsShell>);
    expect(screen.getByRole("link", { name: "분석" })).toHaveAttribute("aria-current", "page");
  });

  it("focuses the current item when the mobile menu opens and restores the menu trigger on Escape", async () => {
    pathname = "/admin/celebrities/kara/quiz";
    render(<AdminOperationsShell locale="ko"><p>content</p></AdminOperationsShell>);
    const menuButton = screen.getByRole("button", { name: "관리자 메뉴" });
    fireEvent.click(menuButton);
    const mobileNavigation = document.getElementById("admin-mobile-navigation");
    expect(mobileNavigation).not.toBeNull();
    const currentLink = within(mobileNavigation!).getByRole("link", { name: "셀럽 콘텐츠" });
    await waitFor(() => expect(currentLink).toHaveFocus());
    fireEvent.keyDown(currentLink, { key: "Escape" });
    expect(document.getElementById("admin-mobile-navigation")).not.toBeInTheDocument();
    expect(menuButton).toHaveFocus();
  });

  it("preserves existing query state when switching language", () => {
    pathname = "/admin/dashboard";
    searchParams = new URLSearchParams("view=brand");
    render(<AdminOperationsShell locale="ko"><p>content</p></AdminOperationsShell>);
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(replace).toHaveBeenCalledWith("/admin/dashboard?view=brand&lang=en", { scroll: false });
  });
});
