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
    ["/admin", "서비스 현황"],
    ["/admin/celebrities", "크리에이터 관리"],
    ["/admin/celebrities/kara/quiz", "크리에이터 관리"],
    ["/admin/lives", "LIVE 관리"],
    ["/admin/lives/live-1/survey", "LIVE 관리"],
    ["/admin/benefits", "혜택·경품"],
    ["/admin/dashboard", "상세 통계"],
    ["/admin/fans", "회원 관리"],
    ["/admin/blockchain-jobs", "디지털 발급 내역"],
    ["/admin/system", "시스템 상태"],
    ["/admin/notifications", "알림 전송"],
    ["/admin/audit", "관리자 활동 기록"],
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
    expect(screen.getByRole("link", { name: "상세 통계" })).toHaveAttribute("aria-current", "page");
  });

  it("focuses the current item when the mobile menu opens and restores the menu trigger on Escape", async () => {
    pathname = "/admin/celebrities/kara/quiz";
    render(<AdminOperationsShell locale="ko"><p>content</p></AdminOperationsShell>);
    const menuButton = screen.getByRole("button", { name: "관리자 메뉴" });
    fireEvent.click(menuButton);
    const mobileNavigation = document.getElementById("admin-mobile-navigation");
    expect(mobileNavigation).not.toBeNull();
    const currentLink = within(mobileNavigation!).getByRole("link", { name: "크리에이터 관리" });
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

  it("groups navigation and exposes the public service without adding unsupported destinations", () => {
    render(<AdminOperationsShell locale="ko"><p>content</p></AdminOperationsShell>);
    const navigation = screen.getByRole("navigation", { name: "관리자 메뉴" });
    expect(within(navigation).getByText("회원")).toBeInTheDocument();
    expect(within(navigation).getByText("콘텐츠")).toBeInTheDocument();
    expect(within(navigation).getByText("운영 관리")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "서비스 열기" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("navigation", { name: "현재 위치" })).toHaveTextContent("서비스 현황");
  });

  it("uses the approved English IA terms", () => {
    pathname = "/admin/celebrities";
    render(<AdminOperationsShell locale="en"><p>content</p></AdminOperationsShell>);
    const navigation = screen.getByRole("navigation", { name: "Admin menu" });
    expect(within(navigation).getByRole("link", { name: "Creator management" })).toHaveAttribute("aria-current", "page");
    expect(within(navigation).getByRole("link", { name: "System status" })).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: "Issuance history" })).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: "Admin activity log" })).toBeInTheDocument();
  });

  it("shows admin management only when an admin role is provided", () => {
    pathname = "/admin/administrators";
    const view = render(<AdminOperationsShell locale="ko" adminRole="admin"><p>content</p></AdminOperationsShell>);
    expect(screen.getByRole("link", { name: "관리자 관리" })).toHaveAttribute("href", "/admin/administrators");
    expect(screen.getByRole("link", { name: "관리자 관리" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "현재 위치" })).toHaveTextContent("관리자 관리");

    view.rerender(<AdminOperationsShell locale="ko" adminRole="operator"><p>content</p></AdminOperationsShell>);
    expect(screen.queryByRole("link", { name: "관리자 관리" })).not.toBeInTheDocument();
  });
});
