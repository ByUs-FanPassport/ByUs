import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnedRaffleResult } from "../domain/raffle-result";
import { RaffleResultPanel } from "./raffle-result-panel";

const won: OwnedRaffleResult = {
  benefitId: "11111111-1111-4111-8111-111111111111", campaignId: "22222222-2222-4222-8222-222222222222",
  title: "한정판 경품", benefitHref: "/benefits/11111111-1111-4111-8111-111111111111", state: "won",
  enteredTickets: 4, entryClosesAt: "2026-09-20T00:00:00+09:00", publishedAt: "2026-09-21T00:00:00+09:00",
  winnerId: "33333333-3333-4333-8333-333333333333", method: "physical_shipping", fulfillmentStatus: "information_required",
  claimDisposition: "active", recipientDeadlineAt: "2099-09-28T00:00:00+09:00", recipientSubmitted: false, recipientEditable: true, policy: null,
};
const lost: OwnedRaffleResult = { ...won, state: "not_won", winnerId: null, fulfillmentStatus: null, recipientEditable: false, recipientDeadlineAt: null };
const originalAnimate = Element.prototype.animate;
function animate() {
  const cancel = vi.fn();
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: vi.fn((_frames, options) => ({
    finished: new Promise((resolve) => setTimeout(resolve, options.duration + (options.delay ?? 0))), cancel,
  })) });
  return cancel;
}

describe("raffle result reveal", () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => {
    cleanup(); vi.useRealTimers(); vi.restoreAllMocks();
    Object.defineProperty(Element.prototype, "animate", { configurable: true, value: originalAnimate });
  });

  it("holds the actual result for 1.8 seconds, then exposes the real recipient route", async () => {
    const cancel = animate();
    render(<RaffleResultPanel result={won} locale="ko" ownerId="owner-a" />);
    fireEvent.click(screen.getByRole("button", { name: "내 결과 확인하기" }), { detail: 1 });
    await act(() => vi.advanceTimersByTimeAsync(1799));
    expect(screen.queryByRole("heading", { name: "당첨됐어요" })).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole("heading", { name: "당첨됐어요" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "수령 정보 입력하기" })).toHaveAttribute("href", `/my/rewards/${won.winnerId}/recipient?locale=ko`);
    expect(document.querySelectorAll("[data-particle]")).toHaveLength(22);
    await act(() => vi.advanceTimersByTimeAsync(1260));
    expect(document.querySelectorAll("[data-particle]")).toHaveLength(0);
    expect(cancel).toHaveBeenCalled();
    expect(localStorage.length).toBe(1);
  });

  it("skips, focuses the result, remembers it, and isolates another account/publication", () => {
    const view = render(<RaffleResultPanel result={won} locale="ko" ownerId="owner-a" />);
    fireEvent.click(screen.getByRole("button", { name: "바로 결과 보기" }));
    expect(screen.getByRole("heading", { name: "당첨됐어요" })).toHaveFocus();
    view.unmount();
    const next = render(<RaffleResultPanel result={won} locale="ko" ownerId="owner-a" />);
    expect(screen.queryByRole("button", { name: "내 결과 확인하기" })).not.toBeInTheDocument();
    next.rerender(<RaffleResultPanel result={won} locale="ko" ownerId="owner-b" />);
    expect(screen.queryByRole("heading", { name: "당첨됐어요" })).not.toBeInTheDocument();
    next.rerender(<RaffleResultPanel result={{ ...won, publishedAt: "2026-10-01T00:00:00Z" }} locale="ko" ownerId="owner-a" />);
    expect(screen.getByRole("button", { name: "내 결과 확인하기" })).toBeInTheDocument();
  });

  it("uses the non-winning artwork and destination without confetti", async () => {
    animate();
    render(<RaffleResultPanel result={lost} locale="en" ownerId="owner-a" />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal my result" }));
    await act(() => vi.advanceTimersByTimeAsync(1800));
    expect(screen.getByRole("heading", { name: "You weren’t selected this time" })).toHaveFocus();
    expect(screen.getByRole("link", { name: "View other raffles" })).toHaveAttribute("href", "/benefits?locale=en");
    expect(document.querySelectorAll("[data-particle]")).toHaveLength(0);
    expect(screen.queryByRole("link", { name: "Enter recipient details" })).not.toBeInTheDocument();
  });

  it("does not remember a reveal abandoned while the tab is hidden or unmounted", async () => {
    const cancel = animate();
    const view = render(<RaffleResultPanel result={won} locale="ko" ownerId="owner-a" />);
    fireEvent.click(screen.getByRole("button", { name: "내 결과 확인하기" }));
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    fireEvent(document, new Event("visibilitychange"));
    expect(localStorage.length).toBe(0);
    hidden.mockReturnValue(false);
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.getByRole("button", { name: "내 결과 확인하기" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "내 결과 확인하기" }));
    view.unmount();
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(cancel).toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it("shows an immediate static result for reduced motion even if storage is unavailable", () => {
    animate();
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    vi.spyOn(window, "matchMedia").mockReturnValue({ ...media, matches: true });
    vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
    render(<RaffleResultPanel result={won} locale="en" ownerId="owner-a" />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal my result" }));
    expect(screen.getByRole("heading", { name: "You won" })).toHaveFocus();
    expect(Element.prototype.animate).not.toHaveBeenCalled();
  });

  it("keeps the recipient action available when Next Image fails", () => {
    const view = render(<RaffleResultPanel result={{ ...won, imageUrl: "/prizes/missing.jpg" }} locale="ko" ownerId="owner-a" />);
    fireEvent.click(screen.getByRole("button", { name: "바로 결과 보기" }));
    fireEvent.error(view.container.querySelector("[data-result-art] img")!);
    expect(view.container.querySelector("[data-result-art] img")).toBeNull();
    expect(screen.getByRole("link", { name: "수령 정보 입력하기" })).toBeInTheDocument();
  });

  it("settles safely when the animation API fails or stalls", async () => {
    Object.defineProperty(Element.prototype, "animate", { configurable: true, value: vi.fn(() => ({ finished: new Promise(() => {}), cancel: vi.fn() })) });
    render(<RaffleResultPanel result={won} locale="ko" ownerId="owner-a" />);
    fireEvent.click(screen.getByRole("button", { name: "내 결과 확인하기" }));
    await act(() => vi.advanceTimersByTimeAsync(2200));
    expect(screen.getByRole("heading", { name: "당첨됐어요" })).toBeInTheDocument();
    cleanup(); localStorage.clear();
    vi.mocked(Element.prototype.animate).mockImplementation(() => { throw new Error("Animation failed"); });
    render(<RaffleResultPanel result={won} locale="ko" ownerId="owner-a" />);
    fireEvent.click(screen.getByRole("button", { name: "내 결과 확인하기" }));
    expect(screen.getByRole("heading", { name: "당첨됐어요" })).toBeInTheDocument();
  });

  it.each(["ready", "shipping_in_transit", "shipping_completed", "pickup_available", "pickup_completed", "digital_delivered"] as const)("never gates fulfillment state %s", (fulfillmentStatus) => {
    render(<RaffleResultPanel result={{ ...won, fulfillmentStatus }} locale="ko" ownerId="owner-a" />);
    expect(screen.queryByRole("button", { name: "내 결과 확인하기" })).not.toBeInTheDocument();
  });
});
