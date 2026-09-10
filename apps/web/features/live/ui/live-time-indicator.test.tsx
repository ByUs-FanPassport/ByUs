import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LiveTimeIndicator } from "./live-time-indicator";

const event = { id: "scheduled", startsAt: "2026-09-12T00:00:00Z", effectiveStatus: "scheduled" as const };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-10T09:00:00Z"));
});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it("emphasizes a future D-day in both variants and stops pulsing when the start is reached", () => {
  const view = render(<><LiveTimeIndicator event={event} locale="ko" /><LiveTimeIndicator event={event} locale="en" variant="text" /></>);
  expect(screen.getAllByText("D-2")).toHaveLength(2);
  expect(view.container.querySelectorAll('[data-pulse="true"]')).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(1);

  act(() => { vi.setSystemTime(new Date(event.startsAt)); vi.advanceTimersByTime(60_000); });
  expect(view.container.querySelector('[data-pulse="true"]')).toBeNull();
  expect(screen.getByText("시작 확인 중")).toBeInTheDocument();
  expect(screen.queryByText("LIVE 진행중")).not.toBeInTheDocument();
});

it("stops the pulse when inactive or hidden and restores it with the visible clock", () => {
  let visibility: DocumentVisibilityState = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  const view = render(<LiveTimeIndicator event={event} locale="ko" active={false} />);
  expect(view.container.firstElementChild).toHaveAttribute("data-pulse", "false");
  view.rerender(<LiveTimeIndicator event={event} locale="ko" />);
  expect(view.container.firstElementChild).toHaveAttribute("data-pulse", "true");

  visibility = "hidden";
  fireEvent(document, new Event("visibilitychange"));
  expect(view.container.firstElementChild).toHaveAttribute("data-pulse", "false");
  expect(vi.getTimerCount()).toBe(0);
  visibility = "visible";
  fireEvent(document, new Event("visibilitychange"));
  expect(view.container.firstElementChild).toHaveAttribute("data-pulse", "true");
});

it.each(["ended", "cancelled"] as const)("keeps %s labels static with no attention dot", effectiveStatus => {
  const view = render(<LiveTimeIndicator event={{ ...event, effectiveStatus }} locale="en" />);
  expect(view.container.firstElementChild).toHaveAttribute("data-pulse", "false");
  expect(view.container.querySelector('[aria-hidden="true"]')).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
