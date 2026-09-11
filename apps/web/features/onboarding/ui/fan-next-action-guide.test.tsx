import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FanNextActionGuide } from "./fan-next-action-guide";
const mock = vi.hoisted(() => ({ path: "/", search: "locale=ko", auth: { ready: true, authenticated: true, user: { id: "" }, getAccessToken: vi.fn() }, summary: { status: "ready", data: { profile: { nickname: null as string | null }, creators: [] } }, refreshFailed: false }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => mock.auth }));
vi.mock("next/navigation", () => ({ usePathname: () => mock.path, useSearchParams: () => new URLSearchParams(mock.search) }));
vi.mock("@/components/fan-ui/use-owned-fan-resource", () => ({ useOwnedFanResource: (url: string | null) => ({ state: url?.includes("summary") ? mock.summary : { status: "loading" }, refreshFailed: mock.refreshFailed }) }));
let counter = 0;
const advance = () => act(async () => { vi.advanceTimersByTime(650); });
beforeEach(() => { vi.useFakeTimers(); mock.path = "/"; mock.search = "locale=ko"; mock.auth.ready = true; mock.auth.authenticated = true; mock.auth.user.id = `guide-owner-${++counter}`; mock.summary = { status: "ready", data: { profile: { nickname: null }, creators: [] } }; mock.refreshFailed = false; sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("fan next-action guide", () => {
  it("offers a dismissible step, traps focus and allows manual reopening without repeat prompts", async () => {
    const view = render(<FanNextActionGuide />); await advance();
    expect(screen.getByRole("dialog")).toHaveAccessibleName("어떤 이름으로 활동할까요?");
    expect(screen.getByRole("link", { name: "닉네임 정하기" })).toHaveAttribute("href", expect.stringContaining("/onboarding/profile"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    mock.path = "/my"; view.rerender(<FanNextActionGuide />); await advance();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "다음 단계" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "나중에 할게요" }));
  });
  it("advances to verification when profile becomes complete", async () => {
    const view = render(<FanNextActionGuide />); await advance();
    fireEvent.click(screen.getByRole("button", { name: "안내 닫기" }));
    mock.summary = { ...mock.summary, data: { profile: { nickname: "Fan" }, creators: [] } };
    view.rerender(<FanNextActionGuide />); await advance();
    expect(screen.getByRole("dialog")).toHaveAccessibleName("최애의 팬임을 인증해 보세요");
    expect(screen.getByRole("link", { name: "최애 선택하기" })).toHaveAttribute("href", "/celebrities?locale=ko");
  });
  it("does not stack over another dialog or interrupt typing", async () => {
    const blocker = document.createElement("div"); blocker.setAttribute("role", "dialog"); document.body.append(blocker);
    render(<FanNextActionGuide />); await advance();
    expect(screen.queryByText("어떤 이름으로 활동할까요?")).toBeNull();
    await act(async () => { blocker.remove(); }); await advance();
    expect(screen.getByRole("dialog")).toHaveAccessibleName("어떤 이름으로 활동할까요?");
  });
  it("clears the visible guide on sign-out and isolates dismissal by owner", async () => {
    const view = render(<FanNextActionGuide />); await advance();
    fireEvent.click(screen.getByRole("button", { name: "안내 닫기" }));
    mock.auth.authenticated = false; view.rerender(<FanNextActionGuide />);
    expect(screen.queryByRole("button", { name: "다음 단계" })).toBeNull();
    mock.auth.authenticated = true; mock.auth.user.id += "-other"; view.rerender(<FanNextActionGuide />); await advance();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("keeps loading, errors, stale refreshes, and active journeys quiet", async () => {
    mock.summary.status = "loading";
    const view = render(<FanNextActionGuide />); await advance(); expect(screen.queryByRole("dialog")).toBeNull();
    mock.summary.status = "error"; view.rerender(<FanNextActionGuide />); await advance(); expect(screen.queryByRole("button")).toBeNull();
    mock.summary.status = "ready"; mock.refreshFailed = true; view.rerender(<FanNextActionGuide />); await advance(); expect(screen.queryByRole("button")).toBeNull();
    mock.refreshFailed = false; mock.path = "/c/kara/verify"; view.rerender(<FanNextActionGuide />); await advance(); expect(screen.queryByRole("button")).toBeNull();
  });
  it("renders English and remains usable when session storage is unavailable", async () => {
    mock.search = "locale=en";
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    render(<FanNextActionGuide />); await advance();
    expect(screen.getByRole("dialog")).toHaveAccessibleName("What should we call you?");
    fireEvent.click(screen.getByRole("button", { name: "Maybe later" }));
    expect(screen.queryByRole("dialog")).toBeNull(); get.mockRestore(); set.mockRestore();
  });
});
