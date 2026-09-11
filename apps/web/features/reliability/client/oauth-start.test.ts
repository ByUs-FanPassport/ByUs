import { afterEach, describe, expect, it, vi } from "vitest";
import { createOAuthStartGuard } from "./oauth-start";
import { RequestTimeoutError } from "./request-deadline";

describe("document OAuth start guard", () => {
  afterEach(() => vi.useRealTimers());

  it.each(["resolve", "reject"] as const)("keeps a timed-out request exclusive after late %s", async (settlement) => {
    vi.useFakeTimers();
    const guard = createOAuthStartGuard();
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const request = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const second = vi.fn().mockResolvedValue(undefined);
    const result = guard.start(() => request, 30_000)!.catch((error: unknown) => error);
    expect(guard.start(second, 30_000)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toBeInstanceOf(RequestTimeoutError);
    expect(guard.getSnapshot()).toBe("restart-required");
    if (settlement === "resolve") resolve(); else reject(new Error("late provider failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(guard.start(second, 30_000)).toBeUndefined();
    expect(second).not.toHaveBeenCalled();
    expect(guard.getSnapshot()).toBe("restart-required");
  });

  it("permits retry after a definitive initialization failure", async () => {
    const guard = createOAuthStartGuard();
    await expect(guard.start(() => Promise.reject(new Error("provider unavailable")), 30_000)).rejects.toThrow("provider unavailable");
    const next = vi.fn().mockResolvedValue(undefined);
    await guard.start(next, 30_000);
    expect(next).toHaveBeenCalledOnce();
    expect(guard.getSnapshot()).toBe("idle");
  });

  it("publishes a synchronous start failure and permits another attempt", async () => {
    const guard = createOAuthStartGuard();
    const observed: string[] = [];
    const unsubscribe = guard.subscribe(() => observed.push(guard.getSnapshot()));
    await expect(guard.start(() => { throw new Error("init failed"); }, 30_000)).rejects.toThrow("init failed");
    expect(observed).toEqual(["starting", "idle"]);
    unsubscribe();
    await guard.start(() => Promise.resolve(), 30_000);
    expect(observed).toEqual(["starting", "idle"]);
  });
});
