import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_REQUEST_TIMEOUT_MS } from "@/features/reliability/client/request-deadline";
import { useNewsSource } from "./use-news-source";

const parse = (body: unknown) => body as { items: { id: string }[]; nextCursor: string | null };
const key = (item: { id: string }) => item.id;
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("turns an unresponsive source into a retryable error and recovers on retry", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValueOnce(Response.json({ items: [{ id: "recovered" }], nextCursor: null }));
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(() => useNewsSource("/api/source", parse, key));
  await act(async () => { await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS + 1); });
  expect(result.current.state.status).toBe("error");
  await act(async () => { result.current.retry(); await vi.advanceTimersByTimeAsync(0); });
  expect(result.current.state.status).toBe("ready");
  expect(result.current.state.data).toEqual([{ id: "recovered" }]);
});
