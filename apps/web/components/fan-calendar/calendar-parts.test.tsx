import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CalendarDayNumber, CalendarMonthHeader } from "./calendar-parts";

describe("shared calendar visual primitives", () => {
  it("preserves full-calendar URLs and exposes month and KST", () => {
    render(<CalendarMonthHeader month="2026-09" label="2026년 9월" headingId="month"
      previous={{ href: "/live/calendar?month=2026-08&locale=ko&celebrity=katseye", label: "이전 달" }}
      next={{ href: "/live/calendar?month=2026-10&locale=ko&celebrity=katseye", label: "다음 달" }} />);
    expect(screen.getByRole("link", { name: "다음 달" })).toHaveAttribute("href", expect.stringContaining("celebrity=katseye"));
    expect(screen.getByRole("heading", { name: "2026년 9월 KST" })).toHaveAttribute("id", "month");
  });
  it("keeps mini calendar navigation local and buttons accessible", () => {
    const next = vi.fn();
    render(<CalendarMonthHeader month="2026-09" label="September 2026" density="compact"
      previous={{ onClick: vi.fn(), label: "Previous month" }} next={{ onClick: next, label: "Next month" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(next).toHaveBeenCalledOnce();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("marks only today on the numeral, independently of a surrounding reservation", () => {
    const { container } = render(<div data-reservation="not_reserved">
      <CalendarDayNumber date="2026-09-05" today="2026-09-05" />
      <CalendarDayNumber date="2026-09-06" today="2026-09-05" />
    </div>);
    expect(container.querySelectorAll('[aria-current="date"]')).toHaveLength(1);
    expect(screen.getByText("5")).toHaveAttribute("data-calendar-today", "true");
    expect(screen.getByText("6")).not.toHaveAttribute("aria-current");
    expect(container.querySelector('[data-reservation]')).toHaveAttribute("data-reservation", "not_reserved");
  });
});
