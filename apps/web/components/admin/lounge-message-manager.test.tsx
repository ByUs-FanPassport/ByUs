import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAccessToken, roleState } = vi.hoisted(() => ({
  getAccessToken: vi.fn(async () => "token"),
  roleState: { current: "viewer" },
}));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: true, user: { id: "admin" }, getAccessToken }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/lounge-messages",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("./use-admin-session", () => ({
  useAdminSession: () => ({ status: "authorized", admin: { role: roleState.current } }),
}));

import { LoungeMessageManager } from "./lounge-message-manager";

const comment = (id: string, body: string) => ({
  id,
  body,
  nickname: "팬",
  celebritySlug: "elina",
  noticeSlug: "hello",
  createdAt: "2026-09-12T00:00:00.000Z",
});

describe("LoungeMessageManager pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roleState.current = "viewer";
  });

  it("moves through opaque cursors and returns through the cursor stack", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return {
        ok: true,
        status: 200,
        json: async () => url.includes("cursor=cursor-1")
          ? { messages: [comment("22222222-2222-4222-8222-222222222222", "두 번째 페이지")], nextCursor: null }
          : { messages: [comment("11111111-1111-4111-8111-111111111111", "첫 번째 페이지")], nextCursor: "cursor-1" },
      } as Response;
    }));

    render(<LoungeMessageManager />);
    expect(await screen.findByText("첫 번째 페이지")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다음 페이지" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "다음 페이지" }));
    expect(await screen.findByText("두 번째 페이지")).toBeInTheDocument();
    expect(vi.mocked(fetch)).toHaveBeenLastCalledWith(
      "/api/admin/lounge-messages?cursor=cursor-1",
      expect.objectContaining({ cache: "no-store" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "이전 페이지" }));
    expect(await screen.findByText("첫 번째 페이지")).toBeInTheDocument();
  });

  it("keeps the previous-page escape available after a page error", async () => {
    let failCursor = true;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("cursor=cursor-1") && failCursor) {
        return { ok: false, status: 503, json: async () => ({}) } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [comment("11111111-1111-4111-8111-111111111111", "첫 페이지")], nextCursor: "cursor-1" }),
      } as Response;
    }));

    render(<LoungeMessageManager />);
    await screen.findByText("첫 페이지");
    fireEvent.click(screen.getByRole("button", { name: "다음 페이지" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("메시지를 불러오지 못했습니다.");
    const previous = screen.getByRole("button", { name: "이전 페이지" });
    expect(previous).toBeEnabled();
    failCursor = false;
    fireEvent.click(previous);
    await waitFor(() => expect(screen.getByText("첫 페이지")).toBeInTheDocument());
  });

  it("blocks page changes while a hide mutation is in flight", async () => {
    roleState.current = "admin";
    let finishHide!: (response: Response) => void;
    const pendingHide = new Promise<Response>((resolve) => { finishHide = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return pendingHide;
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [comment("11111111-1111-4111-8111-111111111111", "검토할 메시지")], nextCursor: "cursor-1" }),
      } as Response;
    }));

    render(<LoungeMessageManager />);
    await screen.findByText("검토할 메시지");
    fireEvent.click(screen.getByRole("button", { name: "숨김 사유 입력" }));
    fireEvent.change(screen.getByRole("textbox", { name: "숨김 사유" }), { target: { value: "운영 기준 위반" } });
    fireEvent.click(screen.getByRole("button", { name: "메시지 숨기기" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "다음 페이지" })).toBeDisabled());
    finishHide({ ok: true, status: 200, json: async () => ({ hidden: true }) } as Response);
    await waitFor(() => expect(screen.getByRole("button", { name: "다음 페이지" })).toBeEnabled());
  });
});
