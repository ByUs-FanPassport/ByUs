import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestTimeoutError, reportRecoveryFailure, withOperationDeadline, withRequestDeadline } from "./request-deadline";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("bounded client requests", () => {
  it("expires a transport that ignores abort and aborts its signal", async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    const result = withRequestDeadline((current) => { signal = current; return new Promise<never>(() => {}); }, { timeoutMs: 100 });
    const rejected = expect(result).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds response parsing, not only response headers", async () => {
    vi.useFakeTimers();
    const result = withRequestDeadline(async () => {
      const response = { json: () => new Promise<never>(() => {}) };
      return response.json();
    }, { timeoutMs: 100 });
    const rejected = expect(result).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
  });

  it("cleans deadlines on success and propagates caller cancellation", async () => {
    vi.useFakeTimers();
    await expect(withRequestDeadline(async () => 42)).resolves.toBe(42);
    expect(vi.getTimerCount()).toBe(0);
    const controller = new AbortController();
    const result = withRequestDeadline(() => new Promise<never>(() => {}), { signal: controller.signal });
    const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start a cancelled request and ignores an SDK promise resolving after timeout", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();
    const request = vi.fn(async () => 1);
    await expect(withRequestDeadline(request, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(request).not.toHaveBeenCalled();
    let complete!: (value: number) => void;
    const sdk = new Promise<number>((resolve) => { complete = resolve; });
    const result = withOperationDeadline(sdk, 100);
    const rejected = expect(result).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    complete(3);
    await expect(sdk).resolves.toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("logs only allowlisted stage and error categories", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    reportRecoveryFailure("login.wallet", new Error("private@example.com Bearer secret"));
    reportRecoveryFailure("private@example.com", new RequestTimeoutError(100));
    expect(warn.mock.calls).toEqual([
      ["[fan-flow] recovery required", { stage: "login.wallet", code: "FAILED" }],
      ["[fan-flow] recovery required", { stage: "unknown", code: "TIMEOUT" }],
    ]);
  });
});
