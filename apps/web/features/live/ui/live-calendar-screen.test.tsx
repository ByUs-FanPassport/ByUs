import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LiveCalendarScreen } from "./live-calendar-screen";

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: false, getAccessToken: vi.fn() }),
}));

const events = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "kara-live",
    startsAt: "2026-09-15T11:00:00.000Z",
    effectiveStatus: "scheduled" as const,
    title: "KARA LIVE",
    celebrity: { name: "KARA", image: "/images/kara.jpg" },
    reservationState: null,
    hasBenefit: null,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    slug: "elina-live",
    startsAt: "2026-09-15T12:00:00.000Z",
    effectiveStatus: "live" as const,
    title: "ELINA LIVE",
    celebrity: { name: "ELINA", image: "/images/elina.jpg" },
    reservationState: "reserved" as const,
    hasBenefit: true,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    slug: "ended-live",
    startsAt: "2026-09-16T11:00:00.000Z",
    effectiveStatus: "ended" as const,
    title: "ENDED LIVE",
    celebrity: { name: "KARA", image: "/images/kara.jpg" },
    reservationState: "not_reserved" as const,
    hasBenefit: false,
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    slug: "cancelled-live",
    startsAt: "2026-09-17T11:00:00.000Z",
    effectiveStatus: "cancelled" as const,
    title: "CANCELLED LIVE",
    celebrity: { name: "ELINA", image: "/images/elina.jpg" },
    reservationState: null,
    hasBenefit: null,
  },
];

const calendar = {
  month: "2026-09",
  timeZone: "Asia/Seoul" as const,
  days: Array.from({ length: 30 }, (_, index) => {
    const date = `2026-09-${String(index + 1).padStart(2, "0")}`;
    const eventsForDay = date === "2026-09-15"
      ? events.slice(0, 2)
      : date === "2026-09-16"
        ? events.slice(2, 3)
        : date === "2026-09-17"
          ? events.slice(3, 4)
          : [];
    return { date, events: eventsForDay };
  }),
};

describe("LIVE calendar screen", () => {
  it("renders every status and multiple Creators on one KST date with detail links", () => {
    const { container } = render(<LiveCalendarScreen locale="ko" initialCalendar={calendar} />);

    expect(screen.getByRole("heading", { name: /2026.*9월/ })).toBeInTheDocument();
    const day = screen.getByRole("group", { name: /2026년 9월 15일/ });
    expect(within(day).getByText("KARA")).toBeInTheDocument();
    expect(within(day).getByText("ELINA")).toBeInTheDocument();
    expect(screen.getByText("예정")).toBeInTheDocument();
    expect(screen.getByText("LIVE 중")).toBeInTheDocument();
    expect(screen.getByText("종료")).toBeInTheDocument();
    expect(screen.getByText("취소")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /KARA LIVE.*상세/ })).toHaveAttribute("href", "/live/kara-live?locale=ko");
    expect(container.querySelector('[style*="--first-weekday"]')).toHaveStyle("--first-weekday: 3");
    expect(screen.getByRole("group", { name: /2026년 9월 1일/ })).not.toHaveAttribute("data-first-column");
    expect(screen.getByRole("group", { name: /2026년 9월 6일/ })).toHaveAttribute("data-first-column", "true");
  });

  it("does not invent a Benefit badge for null/false and shows it only for true", () => {
    render(<LiveCalendarScreen locale="ko" initialCalendar={calendar} />);
    const kara = screen.getByRole("article", { name: "KARA LIVE" });
    const elina = screen.getByRole("article", { name: "ELINA LIVE" });
    const ended = screen.getByRole("article", { name: "ENDED LIVE" });
    expect(within(kara).queryByText(/Benefit/i)).not.toBeInTheDocument();
    expect(within(ended).queryByText(/Benefit/i)).not.toBeInTheDocument();
    expect(within(elina).getByText("Benefit")).toBeInTheDocument();
  });

  it("keeps unknown, reserved, and not-reserved states distinct and links back to the catalog", () => {
    render(<LiveCalendarScreen locale="en" initialCalendar={calendar} />);
    expect(screen.getByRole("link", { name: /All LIVE/i })).toHaveAttribute("href", "/live?locale=en");
    expect(within(screen.getByRole("article", { name: "KARA LIVE" })).queryByText(/reserved/i)).not.toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "ELINA LIVE" })).getByText("Reserved")).toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "ENDED LIVE" })).getByText("Not reserved")).toBeInTheDocument();
  });
});
