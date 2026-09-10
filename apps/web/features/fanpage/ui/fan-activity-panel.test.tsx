import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { FanActivityPanel } from "./fan-activity-panel";

let owner = "owner-a";
const getAccessToken = vi.fn(async (): Promise<string | null> => "token");
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: true, user: { id: owner }, getAccessToken }) }));
const summary = { membershipCount: 1, leaderboardAvailable: false, activity: [{ kind: "joined", tier: null, nickname: "별이", avatarUrl: "/images/avatars/star-cream.webp", occurredAt: "2026-09-10T10:00:00Z" }] };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { owner = "owner-a"; getAccessToken.mockReset().mockResolvedValue("token"); vi.unstubAllGlobals(); });

it("reflects selection before token/PATCH and keeps confirmed data while activity refresh waits", async () => {
  const token = deferred<string>(); const patch = deferred<Response>(); const refresh = deferred<Response>(); let reads = 0;
  const fetcher = vi.fn((url: string, init?: RequestInit) => init?.method === "PATCH" ? patch.promise : url.endsWith("/fanpage") ? (++reads === 1 ? Promise.resolve(Response.json(summary)) : refresh.promise) : Promise.resolve(Response.json({ enabled: false })));
  vi.stubGlobal("fetch", fetcher);
  render(<FanActivityPanel slug="ifewknow" locale="ko" />);
  const checkbox = await screen.findByRole("checkbox");
  getAccessToken.mockReturnValueOnce(token.promise);
  fireEvent.click(checkbox); fireEvent.click(checkbox);
  expect(checkbox).toBeChecked(); expect(checkbox).toBeDisabled(); expect(screen.getByRole("status")).toHaveTextContent("저장 중");
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
  await act(async () => { token.resolve("token"); });
  await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1));
  await act(async () => { patch.resolve(Response.json({ enabled: true })); });
  expect(checkbox).toBeChecked(); expect(checkbox).toBeEnabled(); expect(screen.getByText("별이")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("저장했어요");
  await act(async () => { refresh.resolve(Response.json(summary)); });
  expect(checkbox).toBeChecked();
});

it.each(["http", "invalid", "token"])("rolls back and permits retry after %s failure", async failure => {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => init?.method === "PATCH" ? failure === "http" ? new Response(null, { status: 500 }) : Response.json({ enabled: "yes" }) : _url.endsWith("/fanpage") ? Response.json(summary) : Response.json({ enabled: false })));
  render(<FanActivityPanel slug="ifewknow" locale="ko" />);
  const checkbox = await screen.findByRole("checkbox");
  if (failure === "token") getAccessToken.mockResolvedValueOnce(null);
  fireEvent.click(checkbox);
  await screen.findByRole("alert");
  expect(checkbox).not.toBeChecked(); expect(checkbox).toBeEnabled();
});

it("discards old-owner intent during token wait and never PATCHes the next account", async () => {
  const token = deferred<string>();
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => url.endsWith("/fanpage") ? Response.json(summary) : Response.json({ enabled: false }));
  vi.stubGlobal("fetch", fetcher);
  const view = render(<FanActivityPanel slug="ifewknow" locale="ko" />);
  const checkbox = await screen.findByRole("checkbox");
  getAccessToken.mockReturnValueOnce(token.promise); fireEvent.click(checkbox);
  owner = "owner-b"; view.rerender(<FanActivityPanel slug="ifewknow" locale="ko" />);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  const nextCheckbox = await screen.findByRole("checkbox");
  await act(async () => { token.resolve("owner-b-token"); });
  expect(nextCheckbox).not.toBeChecked(); expect(nextCheckbox).toBeEnabled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(fetcher.mock.calls.every(call => !(call[1] as RequestInit | undefined)?.method)).toBe(true);
});
