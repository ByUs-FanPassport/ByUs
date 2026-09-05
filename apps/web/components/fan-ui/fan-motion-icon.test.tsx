import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FanMotionIcon } from "./fan-motion-icon";

let reduced = false;
let finePointer = true;
let intersect: IntersectionObserverCallback;
beforeEach(() => {
  vi.useFakeTimers(); reduced = false; finePointer = true;
  vi.spyOn(window, "matchMedia").mockImplementation(query => ({ matches: query.includes("reduced") ? reduced : finePointer, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList));
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe(target: Element) { intersect([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    disconnect() {}
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("FanMotionIcon", () => {
  it("animates on the entire action's keyboard focus and stops after one cycle", () => {
    const { container, unmount } = render(<button>Calendar<FanMotionIcon name="calendar" /></button>);
    const icon = container.querySelector("[data-fan-motion]")!;
    fireEvent.focusIn(screen.getByRole("button"));
    expect(icon).toHaveAttribute("data-animating", "true");
    act(() => vi.advanceTimersByTime(1200));
    expect(icon).toHaveAttribute("data-animating", "false");
    unmount();
  });
  it("stays static for reduced motion and touch hover", () => {
    reduced = true;
    const first = render(<button>Gift<FanMotionIcon name="gift" /></button>);
    fireEvent.focusIn(screen.getByRole("button"));
    expect(first.container.querySelector("[data-fan-motion]")).toHaveAttribute("data-animating", "false");
    first.unmount(); reduced = false; finePointer = false;
    const second = render(<button>Ticket<FanMotionIcon name="ticket" /></button>);
    fireEvent.pointerEnter(screen.getByRole("button"));
    expect(second.container.querySelector("[data-fan-motion]")).toHaveAttribute("data-animating", "false");
  });
  it("stops active radio when offscreen, hidden, and unmounted", () => {
    const { container, unmount } = render(<FanMotionIcon name="radio" active />);
    const icon = container.querySelector("[data-fan-motion]")!;
    expect(icon).toHaveAttribute("data-animating", "true");
    act(() => intersect([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(icon).toHaveAttribute("data-animating", "false");
    act(() => vi.advanceTimersByTime(8000));
    expect(icon).toHaveAttribute("data-animating", "false");
    act(() => intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    fireEvent(document, new Event("visibilitychange"));
    expect(icon).toHaveAttribute("data-animating", "false");
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
