import { act, cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeEntryCards } from "./home-entry-cards";
import type { ComponentProps } from "react";

vi.mock("embla-carousel-react", () => ({ default: () => [vi.fn(), null] }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a> }));

const advance = (ms = 3_000) => act(() => { vi.advanceTimersByTime(ms); });
const pointerEnter = (element: HTMLElement, pointerType: string) => {
  const event = createEvent.pointerOver(element);
  Object.defineProperty(event, "pointerType", { value: pointerType });
  fireEvent(element, event);
};
const activeLink = () => document.querySelector('[data-active="true"] a');

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IntersectionObserver", undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("home entry cards", () => {
  it.each(["ko", "en"] as const)("makes each complete card one localized link (%s)", (locale) => {
    const { container } = render(<HomeEntryCards celebrities={[]} eventPhotos={undefined} locale={locale} />);
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAttribute("href", `/pages/ifew-fan-guide?locale=${locale}`);
    expect(links[1]).toHaveAttribute("href", `/pages/elina-fan-guide?locale=${locale}`);
    expect(links[2]).toHaveAttribute("href", `/pages/us-fanmeetings?locale=${locale}`);
    expect(links[0].querySelector("img")).not.toBeNull();
    expect(links[0].querySelector("strong")).not.toBeNull();
    expect(links[1].querySelector("strong")).not.toBeNull();
    expect(container.querySelector("a a, a button")).toBeNull();
    expect(container.textContent).not.toMatch(/KH|FOR ENTERTAINMENT/);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: locale === "ko" ? "다음 가이드" : "Next guide" }));
    expect(activeLink()).toHaveAttribute("href", `/pages/elina-fan-guide?locale=${locale}`);
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("automatically rotates and loops while leaving the fanmeeting link available", () => {
    render(<HomeEntryCards celebrities={[]} eventPhotos={undefined} locale="en" />);
    advance(2_999); expect(activeLink()).toHaveAttribute("href", "/pages/ifew-fan-guide?locale=en");
    advance(1); expect(activeLink()).toHaveAttribute("href", "/pages/elina-fan-guide?locale=en");
    advance(); expect(activeLink()).toHaveAttribute("href", "/pages/ifew-fan-guide?locale=en");
    expect(screen.getByRole("link", { name: "Plan your U.S. fanmeeting with ByUs" })).toBeVisible();
  });

  it("pauses on hover and requires explicit restart after keyboard focus leaves", () => {
    render(<HomeEntryCards celebrities={[]} eventPhotos={undefined} locale="en" />);
    const root = screen.getByRole("region");
    pointerEnter(root, "mouse"); advance();
    expect(activeLink()).toHaveAttribute("href", "/pages/ifew-fan-guide?locale=en");
    fireEvent.pointerLeave(root); advance();
    expect(activeLink()).toHaveAttribute("href", "/pages/elina-fan-guide?locale=en");
    fireEvent.focus(activeLink()!); fireEvent.blur(activeLink()!); advance(12_000);
    expect(activeLink()).toHaveAttribute("href", "/pages/elina-fan-guide?locale=en");
    fireEvent.click(screen.getByRole("button", { name: "Start autoplay" })); advance();
    expect(activeLink()).toHaveAttribute("href", "/pages/ifew-fan-guide?locale=en");
  });

  it("does not leave touch playback stuck in a mouse hover pause", () => {
    render(<HomeEntryCards celebrities={[]} eventPhotos={undefined} locale="en" />);
    pointerEnter(screen.getByRole("region"), "touch");
    const pause = screen.getByRole("button", { name: "Pause autoplay" });
    fireEvent.pointerDown(pause); fireEvent.focus(pause); fireEvent.click(pause);
    advance();
    expect(activeLink()).toHaveAttribute("href", "/pages/ifew-fan-guide?locale=en");
    fireEvent.pointerDown(pause); fireEvent.click(pause); advance();
    expect(activeLink()).toHaveAttribute("href", "/pages/elina-fan-guide?locale=en");
  });

  it("preserves a pointer pause when the same click also focuses the rotation button", () => {
    render(<HomeEntryCards celebrities={[]} eventPhotos={undefined} locale="en" />);
    const pause = screen.getByRole("button", { name: "Pause autoplay" });
    fireEvent.pointerDown(pause); fireEvent.focus(pause); fireEvent.click(pause);
    advance(12_000);
    expect(activeLink()).toHaveAttribute("href", "/pages/ifew-fan-guide?locale=en");
    fireEvent.click(screen.getByRole("button", { name: "Start autoplay" })); advance();
    expect(activeLink()).toHaveAttribute("href", "/pages/elina-fan-guide?locale=en");
  });

  it("suspends offscreen and hidden-page timers and cleans them up on unmount", () => {
    let intersect: (entries: { isIntersecting: boolean }[]) => void = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: typeof intersect) { intersect = callback; }
      observe() { intersect([{ isIntersecting: true }]); }
      disconnect = disconnect;
    });
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const view = render(<HomeEntryCards celebrities={[]} eventPhotos={undefined} locale="en" />);
    act(() => intersect([{ isIntersecting: false }])); advance();
    expect(activeLink()).toHaveAttribute("href", "/pages/ifew-fan-guide?locale=en");
    expect(vi.getTimerCount()).toBe(0);
    act(() => intersect([{ isIntersecting: true }]));
    hidden.mockReturnValue(true); fireEvent(document, new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
    hidden.mockReturnValue(false); fireEvent(document, new Event("visibilitychange")); advance();
    expect(activeLink()).toHaveAttribute("href", "/pages/elina-fan-guide?locale=en");
    view.unmount(); expect(disconnect).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it("respects reduced motion and keeps manual navigation available", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(<HomeEntryCards celebrities={[]} eventPhotos={undefined} locale="en" />);
    advance(12_000);
    expect(activeLink()).toHaveAttribute("href", "/pages/ifew-fan-guide?locale=en");
    expect(screen.getByRole("button", { name: "Start autoplay" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next guide" }));
    expect(activeLink()).toHaveAttribute("href", "/pages/elina-fan-guide?locale=en");
  });
});
