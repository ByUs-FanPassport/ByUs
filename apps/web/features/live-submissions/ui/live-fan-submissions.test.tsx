import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { LiveFanSubmissions } from "./live-fan-submissions";
const auth = vi.hoisted(() => ({ ready: true, authenticated: true, user: { id: "owner-a" } as { id: string } | null, getAccessToken: vi.fn(async () => "token-a"), login: vi.fn() }));
const session = vi.hoisted(() => ({ ready: true, ownerId: "owner-a", generation: 0 }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => auth }));
vi.mock("@/components/byus-session-provider", () => ({ useByUsSession: () => session }));
vi.mock("@/features/content-safety/ui/content-actions", () => ({ ContentTranslation: ({ children }: { children: React.ReactNode }) => children, ContentActions: () => null }));
const id = "10000000-0000-4000-8000-000000000001";
const owned = { id, kind: "question", body: "질문입니다", status: "submitted", revision: 1, createdAt: "2026-09-01T00:00:00Z", selectedAt: null, deletedAt: null };
const base = { settings: { accepting: true, closesAt: "2099-01-01T00:00:00Z", visibility: "public", revision: 1 }, access: "public", mine: [], items: [], nextCursor: null };
beforeEach(() => { vi.unstubAllGlobals(); auth.authenticated = true; auth.user = { id: "owner-a" }; session.ownerId = "owner-a"; session.generation = 0; auth.getAccessToken.mockReset().mockResolvedValue("token-a"); });
it("persists a submitted question then reloads owned state, disabling duplicate writes", async () => {
  let saved = false;
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => { if (init?.method === "POST") { saved = true; return Response.json({ item: owned, replayed: false }); } return Response.json({ ...base, mine: saved ? [owned] : [] }); });
  vi.stubGlobal("fetch", fetcher); render(<LiveFanSubmissions slug="event" celebritySlug="kara" locale="ko" />);
  fireEvent.change(await screen.findByRole("textbox", { name: "질문" }), { target: { value: "질문입니다" } });
  const submit = screen.getByRole("button", { name: "제출" }); fireEvent.click(submit); fireEvent.click(submit);
  await screen.findByText("질문입니다"); expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  expect(screen.queryByRole("textbox", { name: "질문" })).not.toBeInTheDocument();
  const call = fetcher.mock.calls.find(([, init]) => init?.method === "POST")!;
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({ kind: "question", body: "질문입니다" }); expect(JSON.parse(String(call[1]?.body))).not.toHaveProperty("appUserId");
});
it("uses server member gate and removes old owner's visible data before the next read", async () => {
  const fetcher = vi.fn(async () => Response.json({ ...base, access: "members_required", mine: [{ ...owned, body: null }], items: [] }));
  vi.stubGlobal("fetch", fetcher); const view = render(<LiveFanSubmissions slug="event" celebritySlug="kara" locale="ko" />);
  await screen.findByText(/Fan Passport가/); expect(screen.getByRole("link", { name: "팬 인증하기" })).toHaveAttribute("href", "/c/kara/verify?locale=ko"); expect(screen.queryByRole("textbox")).not.toBeInTheDocument(); expect(screen.queryByText("질문입니다")).not.toBeInTheDocument();
  let resolve!: (value: Response) => void; fetcher.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  auth.user = { id: "owner-b" }; session.ownerId = "owner-b"; session.generation++; auth.getAccessToken.mockResolvedValue("token-b");
  view.rerender(<LiveFanSubmissions slug="event" celebritySlug="kara" locale="ko" />);
  expect(screen.queryByRole("button", { name: "삭제" })).not.toBeInTheDocument();
  await waitFor(() => expect(resolve).toBeDefined()); await act(async () => resolve(Response.json({ ...base, settings: { ...base.settings, accepting: false }, mine: [] })));
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
it("closes an already rendered form at the actual deadline", async () => {
 vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-01T00:00:00Z"));
 try {
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({...base,settings:{...base.settings,closesAt:"2026-09-01T00:00:01Z"}})));
 await act(async()=>{render(<LiveFanSubmissions slug="event" celebritySlug="kara" locale="ko"/>);await vi.advanceTimersByTimeAsync(1);});
  expect(screen.getByRole("textbox",{name:"질문"})).toBeInTheDocument();
  await act(async()=>{await vi.advanceTimersByTimeAsync(1001);});
  expect(screen.queryByRole("textbox",{name:"질문"})).not.toBeInTheDocument();
 } finally {vi.useRealTimers();}
});
it("shows the closed state to guests before offering login", async () => {
  auth.authenticated = false; auth.user = null;
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...base, settings: { ...base.settings, accepting: false, closesAt: null } })));
  render(<LiveFanSubmissions slug="event" celebritySlug="kara" locale="ko" />);
  expect(await screen.findByText("마감")).toBeInTheDocument();
  expect(screen.queryByText(/접수 마감:/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "로그인하고 계속" })).not.toBeInTheDocument();
});
it("labels cursor reset by its actual first-page behavior", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json({ ...base, nextCursor: url.includes("cursor=") ? null : "next" })));
  render(<LiveFanSubmissions slug="event" celebritySlug="kara" locale="ko" />);
  fireEvent.click(await screen.findByRole("button", { name: "더 보기" }));
  expect(await screen.findByRole("button", { name: "처음으로" })).toBeInTheDocument();
});
