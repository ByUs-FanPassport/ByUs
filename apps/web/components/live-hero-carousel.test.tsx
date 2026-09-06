import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveEventResponse } from "../features/live/domain/live-event";
import { LiveCountdown, LiveHeroCarousel } from "./live-hero-carousel";

vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("embla-carousel-react", () => ({ default: () => [vi.fn(), null] }));
vi.mock("./auth-intent-link", () => ({ AuthIntentLink: ({ children }: { children: React.ReactNode }) => <a href="/live/test">{children}</a> }));

const live = {
  live: { slug: "test", effectiveStatus: "scheduled", startsAt: "2027-01-02T00:00:00Z", heroImage: { url: "/images/guest-home/kara-card.jpg", alt: "KARA" }, celebrity: { slug: "kara", name: "KARA" } },
  primaryAction: "sign_in_to_reserve",
} as LiveEventResponse;
const advance = (ms = 6_000) => act(() => { vi.advanceTimersByTime(ms); });
const activeSlide = () => document.querySelector('[data-active="true"]')?.getAttribute("aria-label");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("hero visibility and independent pause reasons", () => {
  it("keeps user pause through hover, pointer release and blur", () => {
    render(<LiveHeroCarousel featuredLives={[live]} locale="ko" />);
    const root = screen.getByRole("region");
    fireEvent.click(screen.getByRole("button", { name: "자동 재생 정지" }));
    fireEvent.mouseEnter(root); fireEvent.pointerDown(root);
    fireEvent.mouseLeave(root); fireEvent.pointerUp(window); fireEvent.blur(root);
    advance(12_000);
    expect(activeSlide()).toBe("1 / 2");
    fireEvent.click(screen.getByRole("button", { name: "자동 재생 시작" }));
    advance();
    expect(activeSlide()).toBe("2 / 2");
  });

  it("does not clear keyboard pause when hover ends", () => {
    render(<LiveHeroCarousel featuredLives={[live]} locale="en" />);
    const root = screen.getByRole("region");
    fireEvent.focus(root); fireEvent.mouseEnter(root); fireEvent.mouseLeave(root);
    advance(); expect(activeSlide()).toBe("1 of 2");
    fireEvent.blur(root); advance(); expect(activeSlide()).toBe("2 of 2");
  });

  it("stops timers offscreen and while the document is hidden", () => {
    let intersect: (entries: { isIntersecting: boolean }[]) => void = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: typeof intersect) { intersect = callback; }
      observe() { intersect([{ isIntersecting: true }]); }
      disconnect = disconnect;
    });
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const view = render(<LiveHeroCarousel featuredLives={[live]} locale="en" />);
    act(() => intersect([{ isIntersecting: false }]));
    expect(vi.getTimerCount()).toBe(0);
    advance(); expect(activeSlide()).toBe("1 of 2");
    act(() => intersect([{ isIntersecting: true }]));
    hidden.mockReturnValue(true); fireEvent(document, new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
    hidden.mockReturnValue(false); fireEvent(document, new Event("visibilitychange"));
    advance(); expect(activeSlide()).toBe("2 of 2");
    view.unmount(); expect(disconnect).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps reduced-motion manual navigation and gives only the first image high priority", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(<LiveHeroCarousel featuredLives={[live]} locale="en" />);
    advance(12_000); expect(activeSlide()).toBe("1 of 2");
    expect(screen.getByRole("button", { name: "Pause autoplay" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next LIVE" }));
    expect(activeSlide()).toBe("2 of 2");
    expect(document.querySelectorAll('img[fetchpriority="high"]')).toHaveLength(1);
  });
});

it("updates a resumed countdown from the current clock and has no inactive interval", () => {
  const props = { effectiveStatus: "scheduled" as const, startsAt: "2027-01-01T00:01:00Z" };
  const view = render(<LiveCountdown {...props} active />);
  expect(screen.getByText("00:01:00")).toBeInTheDocument();
  view.rerender(<LiveCountdown {...props} active={false} />);
  expect(vi.getTimerCount()).toBe(0); advance(10_000);
  view.rerender(<LiveCountdown {...props} active />);
  expect(screen.getByText("00:00:50")).toBeInTheDocument();
});
