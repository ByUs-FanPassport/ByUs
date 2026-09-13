import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useFanpageResource } from "./use-fanpage-resource";
let owner = "a";
const getAccessToken = vi.fn(async () => "token");
const session = { ready: true, pending: false, ownerId: null as string | null, generation: 0 };
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: true, user: { id: owner }, getAccessToken }) }));
vi.mock("@/components/byus-session-provider", () => ({ useByUsSession: () => session }));
const parse = (value: unknown) => value as { name: string };
beforeEach(() => { owner = "a"; Object.assign(session, { ready: true, pending: false, ownerId: null, generation: 0 }); getAccessToken.mockClear(); vi.unstubAllGlobals(); });
it("shows an anonymous public response while pending, then accepts only the ready owner's response", async () => {
  Object.assign(session, { ready: false, pending: true, ownerId: "a", generation: 1 });
  let resolveAnonymous!: (value: Response) => void;
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ name: "public" }))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveAnonymous = resolve; }))
    .mockResolvedValueOnce(Response.json({ name: "owner-b" }));
  vi.stubGlobal("fetch", fetcher);
  const { result, rerender } = renderHook(() => useFanpageResource("/activity", parse));
  await waitFor(() => expect(result.current.state).toEqual({ status: "ready", data: { name: "public" } }));
  expect(getAccessToken).not.toHaveBeenCalled();

  Object.assign(session, { ownerId: "b", generation: 2 });
  owner = "b";
  rerender();
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  Object.assign(session, { ready: true, pending: false });
  rerender();
  await waitFor(() => expect(result.current.state).toEqual({ status: "ready", data: { name: "owner-b" } }));
  await act(async () => { resolveAnonymous(Response.json({ name: "late-public" })); });
  expect(result.current.state).toEqual({ status: "ready", data: { name: "owner-b" } });
  expect(getAccessToken).toHaveBeenCalledTimes(1);
});
it("keeps same-owner activity while refreshing, but clears data immediately on owner or URL change", async () => {
  let resolveRead!: (value: Response) => void;
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ name: "a" }))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveRead = resolve; }))
    .mockResolvedValueOnce(Response.json({ name: "b" })).mockResolvedValueOnce(Response.json({ name: "other-page" }));
  vi.stubGlobal("fetch", fetcher);
  const { result, rerender } = renderHook(({ url }) => useFanpageResource(url, parse, true), { initialProps: { url: "/activity" } });
  await waitFor(() => expect(result.current.state).toEqual({ status: "ready", data: { name: "a" } }));
  act(() => result.current.retry());
  expect(result.current.state).toEqual({ status: "ready", data: { name: "a" } });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  owner = "b"; rerender({ url: "/activity" });
  expect(result.current.state.status).toBe("loading");
  await waitFor(() => expect(result.current.state).toEqual({ status: "ready", data: { name: "b" } }));
  await act(async () => { resolveRead(Response.json({ name: "a-stale" })); });
  expect(result.current.state).toEqual({ status: "ready", data: { name: "b" } });
  rerender({ url: "/other" }); expect(result.current.state.status).toBe("loading");
  await waitFor(() => expect(result.current.state).toEqual({ status: "ready", data: { name: "other-page" } }));
});
it("preserves membership error details for default callers", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "MEMBERSHIP_REQUIRED" }, membershipCount: 400 }, { status: 403 })));
  const { result } = renderHook(() => useFanpageResource("/leaderboard", parse));
  await waitFor(() => expect(result.current.state).toEqual({ status: "error", code: "MEMBERSHIP_REQUIRED", membershipCount: 400 }));
});
