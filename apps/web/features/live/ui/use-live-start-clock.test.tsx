import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveStartClock } from "./use-live-start-clock";
import type { LiveStartEvent } from "../domain/live-time-display";

const event = { id: "first", startsAt: "2026-09-10T00:02:17Z", effectiveStatus: "scheduled" as const };
function Probe({ precision = "minute", current = event, active = true, notify, onRender }: {
  precision?: "minute" | "second";
  current?: LiveStartEvent;
  active?: boolean;
  notify?: (event: LiveStartEvent) => void;
  onRender?: () => void;
}) {
  const clock = useLiveStartClock(current, { active, precision, onStartReached: notify });
  onRender?.();
  return <output aria-label={precision}>{clock.now === null ? "pending" : new Date(clock.now).toISOString()}</output>;
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-10T00:00:10Z")); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("shared LIVE start clock", () => {
  it("hits a compact start at its exact non-minute deadline and stops", () => {
    const notify = vi.fn();
    render(<Probe notify={notify} />);
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(126_999));
    expect(notify).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(event);
    expect(screen.getByLabelText("minute")).toHaveTextContent("2026-09-10T00:02:17.000Z");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shares one timer and does not rerender compact displays for detailed second ticks", () => {
    const onRender = vi.fn();
    render(<><Probe onRender={onRender} /><Probe precision="second" /></>);
    expect(vi.getTimerCount()).toBe(1);
    const compactRenders = onRender.mock.calls.length;
    act(() => vi.advanceTimersByTime(10_000));
    expect(onRender).toHaveBeenCalledTimes(compactRenders);
    expect(screen.getByLabelText("second")).toHaveTextContent("00:00:20.000Z");
    expect(screen.getByLabelText("minute")).toHaveTextContent("00:00:10.000Z");
    act(() => vi.advanceTimersByTime(40_000));
    expect(screen.getByLabelText("minute")).toHaveTextContent("00:01:00.000Z");
    expect(vi.getTimerCount()).toBe(1);
  });

  it("pauses hidden and checks an elapsed start once immediately on return", () => {
    let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const notify = vi.fn();
    render(<Probe notify={notify} />);
    visibility = "hidden";
    fireEvent(document, new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(180_000));
    expect(notify).not.toHaveBeenCalled();
    visibility = "visible";
    fireEvent(document, new Event("visibilitychange"));
    expect(notify).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refreshes one handler once for a shared event/start across instances and remounts", () => {
    const notify = vi.fn();
    const view = render(<><Probe notify={notify} /><Probe precision="second" notify={notify} /></>);
    act(() => vi.advanceTimersByTime(127_000));
    expect(notify).toHaveBeenCalledOnce();
    view.unmount();
    render(<Probe notify={notify} />);
    expect(notify).toHaveBeenCalledOnce();
  });

  it("has no inactive timer and adopts the current clock when activated", () => {
    const view = render(<Probe active={false} />);
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(20_000));
    view.rerender(<Probe />);
    expect(screen.getByLabelText("minute")).toHaveTextContent("00:00:30.000Z");
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
