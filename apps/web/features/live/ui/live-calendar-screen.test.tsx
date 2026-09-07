import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
  {
    id: "55555555-5555-4555-8555-555555555555",
    slug: "kara-after-talk",
    startsAt: "2026-09-15T13:00:00.000Z",
    effectiveStatus: "scheduled" as const,
    title: "KARA AFTER TALK",
    celebrity: { name: "KARA", image: "/images/kara.jpg" },
    reservationState: "not_reserved" as const,
    hasBenefit: false,
  },
  {
    id: "66666666-6666-4666-8666-666666666666",
    slug: "elina-after-party",
    startsAt: "2026-09-15T14:00:00.000Z",
    effectiveStatus: "scheduled" as const,
    title: "ELINA AFTER PARTY",
    celebrity: { name: "ELINA", image: "/images/elina.jpg" },
    reservationState: "not_reserved" as const,
    hasBenefit: false,
  },
];

const calendar = {
  month: "2026-09",
  timeZone: "Asia/Seoul" as const,
  days: Array.from({ length: 30 }, (_, index) => {
    const date = `2026-09-${String(index + 1).padStart(2, "0")}`;
    const eventsForDay = date === "2026-09-15"
      ? [events[0]!, events[1]!, events[4]!, events[5]!]
      : date === "2026-09-16"
        ? events.slice(2, 3)
        : date === "2026-09-17"
          ? events.slice(3, 4)
          : [];
    return { date, events: eventsForDay };
  }),
};

const celebrities = [
  { slug: "kara", name: "KARA", image: "/images/kara.jpg" },
  { slug: "elina", name: "ELINA", image: "/images/elina.jpg" },
];

const eventMetadata = [
  { eventSlug: "kara-live", celebritySlug: "kara", platforms: ["youtube", "instagram"] as const },
  { eventSlug: "elina-live", celebritySlug: "elina", platforms: ["tiktok"] as const },
  { eventSlug: "ended-live", celebritySlug: "kara", platforms: ["youtube"] as const },
  { eventSlug: "cancelled-live", celebritySlug: "elina", platforms: ["instagram"] as const },
  { eventSlug: "kara-after-talk", celebritySlug: "kara", platforms: ["youtube"] as const },
  { eventSlug: "elina-after-party", celebritySlug: "elina", platforms: ["instagram"] as const },
];

function renderCalendar(locale: "ko" | "en" = "ko", initialCelebritySlugs: readonly string[] = []) {
  return render(<LiveCalendarScreen
    locale={locale}
    initialCalendar={calendar}
    celebrities={celebrities}
    eventMetadata={eventMetadata}
    initialCelebritySlugs={initialCelebritySlugs}
  />);
}

describe("LIVE calendar screen", () => {
  it.each(["scheduled", "live", "ended", "cancelled"] as const)("marks only actionable mobile dates for %s events", (status) => {
    const { container } = render(<LiveCalendarScreen locale="ko" initialCelebritySlugs={[]} initialCalendar={{ ...calendar, days: calendar.days.map(day => ({ ...day, events: day.date === "2026-09-15" ? [{ ...events[0]!, effectiveStatus: status }] : [] })) }} celebrities={celebrities} eventMetadata={eventMetadata} />);
    const date = container.querySelector('[data-calendar-date="2026-09-15"]');
    if (status === "scheduled" || status === "live") expect(date).toHaveAttribute("data-upcoming-day", "true");
    else expect(date).not.toHaveAttribute("data-upcoming-day");
    expect(container.querySelector('[data-calendar-date="2026-09-01"]')).not.toHaveAttribute("data-upcoming-day");
    fireEvent.click(screen.getByRole("button", { name: "ELINA" }));
    expect(date).not.toHaveAttribute("data-upcoming-day");
  });

  it("selects a mobile date without removing the desktop month's events and can clear it", () => {
    renderCalendar();
    const date = screen.getByRole("button", { name: /2026년 9월 15일.*4 LIVE/ });
    fireEvent.click(date);
    expect(date).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("group", { name: /2026년 9월 16일/ })).toHaveAttribute("data-mobile-hidden", "true");
    expect(screen.getByRole("article", { name: "ENDED LIVE" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "전체 보기" }).find(button => !button.hasAttribute("aria-haspopup"))!);
    expect(date).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("group", { name: /2026년 9월 16일/ })).not.toHaveAttribute("data-mobile-hidden");
  });

  it("updates mobile date counts with multi-creator filters and resets the date when filters change", () => {
    renderCalendar();
    fireEvent.click(screen.getByRole("button", { name: /2026년 9월 15일.*4 LIVE/ }));
    fireEvent.click(screen.getByRole("button", { name: "KARA" }));
    expect(screen.getByRole("button", { name: /2026년 9월 15일.*2 LIVE/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("article", { name: "ELINA LIVE" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ELINA" }));
    expect(screen.getByRole("button", { name: /2026년 9월 15일.*4 LIVE/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /2026년 9월 1일.*0 LIVE/ }));
    expect(screen.getByRole("button", { name: /2026년 9월 1일.*0 LIVE/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "전체 셀럽 일정" }));
    expect(screen.getByRole("button", { name: /2026년 9월 1일.*0 LIVE/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("renders every status and multiple Creators on one KST date with detail links", () => {
    const { container } = renderCalendar();

    expect(screen.getByRole("heading", { name: /2026.*9월/ })).toBeInTheDocument();
    const day = screen.getByRole("group", { name: /2026년 9월 15일/ });
    expect(within(day).getAllByText("KARA")[0]).toBeInTheDocument();
    expect(within(day).getAllByText("ELINA")[0]).toBeInTheDocument();
    expect(screen.getAllByText("예정")[0]).toBeInTheDocument();
    expect(screen.getByText("LIVE 중")).toBeInTheDocument();
    expect(screen.getByText("종료")).toBeInTheDocument();
    expect(screen.getByText("취소")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /KARA LIVE.*상세/ })).toHaveAttribute("href", "/live/kara-live?locale=ko");
    expect(container.querySelectorAll('[data-outside-month="true"]')).toHaveLength(5);
    expect(screen.getByRole("group", { name: /2026년 9월 1일/ })).not.toHaveAttribute("data-first-column");
    expect(screen.getByRole("group", { name: /2026년 9월 6일/ })).toHaveAttribute("data-first-column", "true");
  });

  it("does not invent a Benefit badge for null/false and shows it only for true", () => {
    renderCalendar();
    const kara = screen.getByRole("article", { name: "KARA LIVE" });
    const elina = screen.getByRole("article", { name: "ELINA LIVE" });
    const ended = screen.getByRole("article", { name: "ENDED LIVE" });
    expect(within(kara).queryByText(/Benefit/i)).not.toBeInTheDocument();
    expect(within(ended).queryByText(/Benefit/i)).not.toBeInTheDocument();
    expect(within(elina).getByText("Benefit")).toBeInTheDocument();
  });

  it("keeps unknown, reserved, and not-reserved states distinct and links back to the catalog", () => {
    renderCalendar("en");
    expect(screen.getByRole("link", { name: /All LIVE/i })).toHaveAttribute("href", "/live?locale=en");
    expect(within(screen.getByRole("article", { name: "KARA LIVE" })).queryByText(/reserved/i)).not.toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "ELINA LIVE" })).getByText("Reserved")).toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "ENDED LIVE" })).getByText("Not reserved")).toBeInTheDocument();
  });

  it("preserves a creator entry filter, supports multi-select, and can return to every schedule", () => {
    renderCalendar("ko", ["kara"]);

    expect(screen.getByRole("button", { name: "KARA" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("article", { name: "KARA LIVE" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "ELINA LIVE" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /다음 달/ })).toHaveAttribute(
      "href",
      "/live/calendar?month=2026-10&locale=ko&celebrity=kara",
    );

    fireEvent.click(screen.getByRole("button", { name: "ELINA" }));
    expect(screen.getByRole("article", { name: "ELINA LIVE" })).toBeInTheDocument();
    expect(screen.getByText("2명 선택")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "전체 셀럽 일정" }));
    expect(screen.getByRole("button", { name: "전체 셀럽 일정" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText("전체 보기")[0]).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "KARA LIVE" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "ELINA LIVE" })).toBeInTheDocument();
  });

  it("renders every platform icon for a simulcast-capable calendar event", () => {
    renderCalendar();
    expect(within(screen.getByRole("article", { name: "KARA LIVE" })).getByLabelText(
      "송출 플랫폼: YouTube, Instagram",
    )).toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "ELINA LIVE" })).getByLabelText(
      "송출 플랫폼: TikTok",
    )).toBeInTheDocument();
  });

  it("browses crowded desktop dates with bounded controls and opens all events in a dialog", async () => {
    renderCalendar();
    const day = screen.getByRole("group", { name: /2026년 9월 15일/ });
    const current = () => day.querySelector('[data-current="true"]');
    expect(current()).toHaveAccessibleName("KARA LIVE");
    expect(within(day).getByRole("button", { name: "이전 LIVE" })).toBeDisabled();
    for (let index = 0; index < 3; index++) fireEvent.click(within(day).getByRole("button", { name: "다음 LIVE" }));
    expect(current()).toHaveAccessibleName("ELINA AFTER PARTY");
    expect(within(day).getByRole("button", { name: "다음 LIVE" })).toBeDisabled();
    fireEvent.click(within(day).getByRole("button", { name: "이전 LIVE" }));
    expect(current()).toHaveAccessibleName("KARA AFTER TALK");
    const trigger = within(day).getByRole("button", { name: "전체 보기" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByRole("article")).toHaveLength(4);
    expect(within(dialog).getByRole("link", { name: "ELINA AFTER PARTY 상세 보기" })).toHaveAttribute("href", "/live/elina-after-party?locale=ko");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await vi.waitFor(() => expect(trigger).toHaveFocus());
  });

  it("resets carousel selection with filters and omits controls on single or empty dates", () => {
    renderCalendar();
    const day = screen.getByRole("group", { name: /2026년 9월 15일/ });
    fireEvent.click(within(day).getByRole("button", { name: "다음 LIVE" }));
    fireEvent.click(screen.getByRole("button", { name: "KARA" }));
    expect(day.querySelector('[data-current="true"]')).toHaveAccessibleName("KARA LIVE");
    const single = screen.getByRole("group", { name: /2026년 9월 16일/ });
    expect(within(single).queryByRole("button")).not.toBeInTheDocument();
    const empty = screen.getByRole("group", { name: /2026년 9월 1일/ });
    expect(within(empty).queryByRole("button")).not.toBeInTheDocument();
  });

  it("closes the modal on close button, backdrop, and month replacement", () => {
    const view = renderCalendar("en");
    const open = () => fireEvent.click(screen.getAllByRole("button", { name: "View all" })[0]!);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    open();
    fireEvent.pointerDown(document.querySelector('[data-overlay-root]')!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    open();
    view.rerender(<LiveCalendarScreen locale="en" initialCalendar={{...calendar, month:"2026-10", days:[]}} celebrities={celebrities} eventMetadata={eventMetadata} initialCelebritySlugs={[]} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
