import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthTransitionBoundary, isPublicSessionTransitionRoute } from "./auth-transition-boundary";

const mocks = vi.hoisted(() => ({
  pathname: "/",
  query: new URLSearchParams(),
  session: { ready: false, pending: true, ownerId: "fan-a", generation: 1 },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => mocks.query,
}));
vi.mock("./locale-provider", () => ({ useAppLocale: () => ({ locale: "ko" }) }));
vi.mock("./byus-session-provider", () => ({ useByUsSession: () => mocks.session }));

describe("auth transition route boundary", () => {
  beforeEach(() => {
    mocks.pathname = "/";
    mocks.query = new URLSearchParams();
    mocks.session = { ready: false, pending: true, ownerId: "fan-a", generation: 1 };
  });

  it.each([
    "/", "/my", "/passports", "/passports/passport-1", "/kara", "/c/kara",
    "/live", "/live/calendar", "/live/kara-nualeaf",
  ])("allows the audited public destination %s", (pathname) => {
    expect(isPublicSessionTransitionRoute(pathname)).toBe(true);
  });

  it.each([
    "/my/rewards", "/passports/passport-1/issuance", "/c/kara/verify", "/c/kara/lounge",
    "/live/kara-nualeaf/missions", "/live/kara-nualeaf/survey", "/admin", "/settings",
  ])("keeps the protected destination %s gated", (pathname) => {
    expect(isPublicSessionTransitionRoute(pathname)).toBe(false);
  });

  it("allows creator homes only with no tab or the exact home tab", () => {
    expect(isPublicSessionTransitionRoute("/kara", new URLSearchParams("tab=home"))).toBe(true);
    expect(isPublicSessionTransitionRoute("/c/kara", new URLSearchParams("tab=live"))).toBe(false);
    expect(isPublicSessionTransitionRoute("/kara", new URLSearchParams("tab=home&tab=live"))).toBe(false);
    expect(isPublicSessionTransitionRoute("/login")).toBe(false);
  });

  it("shows the public page and status while suppressing the parallel modal", () => {
    render(<AuthTransitionBoundary modal={<aside>private modal</aside>}><div>public page</div></AuthTransitionBoundary>);
    expect(screen.getByText("public page")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("로그인을 마무리하고 있어요.");
    expect(screen.queryByText("private modal")).not.toBeInTheDocument();
  });

  it("mounts neither protected page nor modal while pending", () => {
    mocks.pathname = "/my/rewards";
    render(<AuthTransitionBoundary modal={<aside>private modal</aside>}><div>private page</div></AuthTransitionBoundary>);
    expect(screen.queryByText("private page")).not.toBeInTheDocument();
    expect(screen.queryByText("private modal")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("leaves login recovery reachable and restores both slots after completion", () => {
    mocks.pathname = "/login";
    const view = render(<AuthTransitionBoundary modal={<aside>login modal</aside>}><div>login page</div></AuthTransitionBoundary>);
    expect(screen.getByText("login page")).toBeInTheDocument();
    expect(screen.getByText("login modal")).toBeInTheDocument();
    mocks.pathname = "/my/rewards";
    mocks.session = { ready: true, pending: false, ownerId: "fan-a", generation: 1 };
    view.rerender(<AuthTransitionBoundary modal={<aside>ready modal</aside>}><div>ready page</div></AuthTransitionBoundary>);
    expect(screen.getByText("ready page")).toBeInTheDocument();
    expect(screen.getByText("ready modal")).toBeInTheDocument();
  });
});
