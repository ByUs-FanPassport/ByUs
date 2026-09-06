import "@testing-library/jest-dom/vitest";
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarArt } from "./calendar-art";
const elina = { slug: "elina", name: "Elina", image: "/fallback.jpg" };
const changha = { slug: "changha", name: "Changha", image: "/fallback.jpg" };
afterEach(() => vi.useRealTimers());
describe("calendar art transition", () => {
  it("keeps a creator across month changes and cancels stale replacements on rapid selection", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<CalendarArt month="2026-09" celebrity={elina} />);
    expect(container.querySelectorAll('img[src*="hero-"]')).toHaveLength(2);
    rerender(<CalendarArt month="2026-10" celebrity={elina} />);
    expect(container.querySelector('[data-calendar-art-mode="elina"]')).toBeInTheDocument();
    expect(container.querySelector('img[src*="october.svg"]')).toBeInTheDocument();
    rerender(<CalendarArt month="2026-10" celebrity={changha} />);
    act(() => vi.advanceTimersByTime(70));
    rerender(<CalendarArt month="2026-10" />);
    act(() => vi.advanceTimersByTime(140));
    expect(container.querySelector('[data-calendar-art-mode="byus"]')).toBeInTheDocument();
    expect(container.querySelector('[data-calendar-art-mode="changha"]')).not.toBeInTheDocument();
  });
  it("does not replace the ByUs node when all/multiple selections share the same visual", () => {
    const { container, rerender } = render(<CalendarArt month="2026-09" />);
    const brand = container.querySelector('[data-calendar-art-mode="byus"]');
    rerender(<CalendarArt month="2026-10" />);
    expect(container.querySelector('[data-calendar-art-mode="byus"]')).toBe(brand);
  });
});
