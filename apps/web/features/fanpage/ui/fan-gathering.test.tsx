import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FanGathering } from "./fan-gathering";
const fans = [{ nickname: "달빛길", avatarUrl: "/images/avatars/fairy-cream.webp" }, { nickname: "별빛팬", avatarUrl: "/images/avatars/star-pink.webp" }];
let nextFrame = 0, time = 0;
const frames = new Map<number, FrameRequestCallback>(), captures = new Set<number>();
function tick(count = 1) { for (let i = 0; i < count; i++) act(() => { time += 16; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(time)); }); }
function pointer(node: HTMLElement, type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, { isPrimary: { value: true }, button: { value: 0 }, pointerId: { value: 1 }, pointerType: { value: "touch" }, clientX: { value: x }, clientY: { value: y } }); fireEvent(node, event);
}
beforeEach(() => {
  frames.clear(); captures.clear(); nextFrame = 0; time = 0;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(306);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(350);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: (id: number) => captures.add(id) },
    hasPointerCapture: { configurable: true, value: (id: number) => captures.has(id) },
    releasePointerCapture: { configurable: true, value: (id: number) => captures.delete(id) },
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("releases a cancelled touch drag without leaving a pinned name or captured pointer", () => {
  render(<FanGathering fans={fans} fanCount={2} locale="ko" />); tick(2);
  const first = screen.getByRole("button", { name: "달빛길" });
  pointer(first, "pointerdown", 153, 175); pointer(first, "pointermove", 210, 230); tick(12);
  expect(screen.getByRole("tooltip")).toHaveTextContent("달빛길");
  pointer(first, "pointercancel", 210, 230);
  expect(captures.size).toBe(0); expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  const released = first.style.transform; tick(2); expect(first.style.transform).not.toBe(released);
  pointer(first, "pointerup", 210, 230); expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});
it("stops frames while paused or hidden and resumes from the current positions", () => {
  render(<FanGathering fans={fans} fanCount={2} locale="en" />); tick(2);
  const first = screen.getByRole("button", { name: "달빛길" });
  fireEvent.click(screen.getByRole("button", { name: "Pause motion" }));
  const paused = first.style.transform; tick(3); expect(first.style.transform).toBe(paused); expect(frames.size).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Resume motion" })); expect(first.style.transform).toBe(paused);
  tick(3); expect(first.style.transform).not.toBe(paused);
  vi.spyOn(document, "hidden", "get").mockReturnValue(true); fireEvent(document, new Event("visibilitychange"));
  const hidden = first.style.transform; tick(3); expect(first.style.transform).toBe(hidden); expect(frames.size).toBe(0);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false); fireEvent(document, new Event("visibilitychange"));
  tick(3); expect(first.style.transform).not.toBe(hidden);
});
