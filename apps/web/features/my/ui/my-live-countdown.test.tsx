import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatMyLiveCountdown, MyLiveCountdown } from "./my-live-countdown";

const start = "2026-09-10T00:00:00.000Z";
const scheduled = { id: "live-1", startsAt: start, effectiveStatus: "scheduled" as const };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-08T23:59:59.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("MyLiveCountdown", () => {
  it("allows catalog D-day pulse with the same shared clock and stops at start", () => {
    const view = render(<><MyLiveCountdown event={scheduled} locale="ko" pulseScheduled /><MyLiveCountdown event={{...scheduled, id:"second"}} locale="en" /></>);
    expect(view.container.firstElementChild).toHaveAttribute("data-pulse", "true");
    expect(vi.getTimerCount()).toBe(1);
    act(() => { vi.setSystemTime(new Date(start)); vi.advanceTimersByTime(1000); });
    expect(view.container.firstElementChild).toHaveAttribute("data-pulse", "false");
    expect(screen.queryByText("진행 중")).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("formats scheduled events above and below 24 hours", () => {
    expect(formatMyLiveCountdown(start, Date.parse("2026-09-08T23:59:59.000Z"))).toBe("D-1");
    expect(formatMyLiveCountdown(start, Date.parse("2026-09-09T23:59:59.000Z"))).toBe("곧 시작");
  });

  it("clamps exact and elapsed scheduled events without claiming they are live", () => {
    vi.setSystemTime(new Date(start));
    const exact = render(<MyLiveCountdown event={scheduled} locale="ko" />);
    expect(screen.getByText("시작 확인 중")).toBeInTheDocument();
    expect(screen.queryByText(/LIVE NOW|Live now|진행 중/)).not.toBeInTheDocument();
    exact.unmount();

    vi.setSystemTime(new Date("2026-09-10T00:30:00.000Z"));
    render(<MyLiveCountdown event={scheduled} locale="en" />);
    expect(screen.getByText("Checking start")).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the server live state and locale copy", () => {
    const view = render(<MyLiveCountdown event={{ ...scheduled, effectiveStatus: "live" }} locale="ko" />);
    expect(screen.getByText("진행 중")).toBeInTheDocument();
    expect(view.container.firstElementChild).toHaveAttribute("data-pulse", "true");
    expect(vi.getTimerCount()).toBe(0);

    view.rerender(<MyLiveCountdown event={{ ...scheduled, effectiveStatus: "live" }} locale="en" />);
    expect(screen.getByText("Live now")).toBeInTheDocument();
  });

  it("does not display ended or cancelled events", () => {
    const ended = render(<MyLiveCountdown event={{ ...scheduled, effectiveStatus: "ended" }} locale="ko" />);
    expect(ended.container).toBeEmptyDOMElement();
    ended.rerender(<MyLiveCountdown event={{ ...scheduled, effectiveStatus: "cancelled" }} locale="ko" />);
    expect(ended.container).toBeEmptyDOMElement();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pauses while hidden and restores from the current clock immediately", () => {
    vi.setSystemTime(new Date("2026-09-09T23:59:00.000Z"));
    let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const view = render(<MyLiveCountdown event={scheduled} locale="en" />);
    expect(screen.getByText("Starts in 1 min")).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(1);

    visibility = "hidden";
    fireEvent(document, new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
    expect(view.container.firstElementChild).toHaveAttribute("data-pulse", "false");

    vi.setSystemTime(new Date("2026-09-09T23:59:50.000Z"));
    visibility = "visible";
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.getByText("Starting soon")).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(1);
  });

  it("does not start or notify when initially hidden", () => {
    vi.setSystemTime(new Date("2026-09-10T00:00:01.000Z"));
    let visibility: DocumentVisibilityState = "hidden";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const onStartReached = vi.fn();
    render(<MyLiveCountdown event={scheduled} locale="ko" onStartReached={onStartReached} />);

    expect(vi.getTimerCount()).toBe(0);
    expect(onStartReached).not.toHaveBeenCalled();

    visibility = "visible";
    fireEvent(document, new Event("visibilitychange"));
    expect(onStartReached).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shares one scheduler and visibility listener across multiple mounted countdowns", () => {
    const setInterval = vi.spyOn(window, "setTimeout");
    const addEventListener = vi.spyOn(document, "addEventListener");
    const removeEventListener = vi.spyOn(document, "removeEventListener");
    const visibilityAdds = () => addEventListener.mock.calls
      .filter(([type]) => type === "visibilitychange").length;
    const visibilityRemovals = () => removeEventListener.mock.calls
      .filter(([type]) => type === "visibilitychange").length;

    const first = render(<MyLiveCountdown event={scheduled} locale="ko" />);
    const second = render(<MyLiveCountdown event={{ ...scheduled, id: "live-2" }} locale="en" />);

    expect(setInterval).toHaveBeenCalledTimes(1);
    expect(visibilityAdds()).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    first.unmount();
    expect(visibilityRemovals()).toBe(0);
    expect(vi.getTimerCount()).toBe(1);

    second.unmount();
    expect(visibilityRemovals()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("has no inactive timer or pulse and cleans up on unmount", () => {
    const view = render(<MyLiveCountdown event={scheduled} locale="ko" active={false} />);
    expect(vi.getTimerCount()).toBe(0);
    expect(view.container.firstElementChild).toHaveAttribute("data-active", "false");
    expect(view.container.firstElementChild).toHaveAttribute("data-pulse", "false");

    view.rerender(<MyLiveCountdown event={scheduled} locale="ko" />);
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("notifies once for each event id and start pair, including an already elapsed start", () => {
    vi.setSystemTime(new Date("2026-09-09T23:59:59.000Z"));
    const onStartReached = vi.fn();
    const view = render(<MyLiveCountdown event={scheduled} locale="ko" onStartReached={onStartReached} />);

    act(() => vi.advanceTimersByTime(1_000));
    expect(onStartReached).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(5_000));
    expect(onStartReached).toHaveBeenCalledTimes(1);

    const elapsed = { ...scheduled, id: "live-2" };
    view.rerender(<MyLiveCountdown event={elapsed} locale="ko" onStartReached={onStartReached} />);
    expect(onStartReached).toHaveBeenCalledTimes(2);
    view.rerender(<MyLiveCountdown event={elapsed} locale="ko" onStartReached={vi.fn()} />);
    expect(onStartReached).toHaveBeenCalledTimes(2);
  });

  it("uses the latest callback without restarting its scheduler", () => {
    const first = vi.fn();
    const latest = vi.fn();
    const interval = vi.spyOn(window, "setTimeout");
    const view = render(<MyLiveCountdown event={scheduled} locale="en" onStartReached={first} />);
    expect(interval).toHaveBeenCalledTimes(1);
    view.rerender(<MyLiveCountdown event={scheduled} locale="en" onStartReached={latest} />);
    expect(interval).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(24 * 60 * 60 * 1_000 + 1_000));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("keeps ticking silent and disables dot motion for reduced-motion users", () => {
  const source = readFileSync(resolve(process.cwd(), "features/my/ui/my-live-countdown.module.css"), "utf8");
  expect(source).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);

  const view = render(<MyLiveCountdown event={scheduled} locale="en" />);
  expect(view.container.firstElementChild).toHaveAttribute("aria-live", "off");
});
