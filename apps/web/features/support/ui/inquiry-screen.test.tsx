import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const { auth, adminSession, push } = vi.hoisted(() => ({
  auth: { ready: true, authenticated: true, user: { id: "fan-a" }, getAccessToken: vi.fn(async () => "token-a") },
  adminSession: { value: { status: "authorized", admin: { email: "admin@example.test", role: "operator" } } },
  push: vi.fn(),
}));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => auth }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: ReactNode; href: string }) => <a {...props}>{children}</a> }));
vi.mock("@/components/fan-shell/fan-app-shell", () => ({
  FanAppFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FanContentContainer: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/admin/operations-shell", () => ({ AdminOperationsShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/admin/use-admin-session", () => ({ useAdminSession: () => adminSession.value }));
import { AdminInquiryScreen, InquiryScreen } from "./inquiry-screen";

const id = "33333333-3333-4333-8333-333333333333", messageId = "22222222-2222-4222-8222-222222222222";
const now = "2026-09-11T12:00:00.000Z";
const inquiry = { id, subject: "예약 확인", locale: "ko", status: "open", version: 1, requesterName: "별빛", createdAt: now, updatedAt: now };
const message = { id: messageId, sender: "fan", body: "제 예약을 확인하고 싶어요.", createdAt: now };
const detail = { inquiry, messages: [message], nextCursor: null };
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const fetcher = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", fetcher);
  auth.ready = true; auth.authenticated = true; auth.user = { id: "fan-a" };
  auth.getAccessToken.mockResolvedValue("token-a");
  adminSession.value = { status: "authorized", admin: { email: "admin@example.test", role: "operator" } };
  fetcher.mockImplementation(() => json(detail));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("CS inquiry screens", () => {
  it("returns a guest to their exact inquiry after login and never loads private data", () => {
    auth.authenticated = false;
    render(<InquiryScreen locale="en" id={id} />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", expect.stringContaining(encodeURIComponent(`/my/inquiries/${id}?locale=en`)));
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("keeps a failed draft and uses the same key to safely retry delivery", async () => {
    const posts: Record<string, unknown>[] = [];
    fetcher.mockImplementation((_url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        posts.push(JSON.parse(String(options.body)));
        return posts.length === 1 ? Promise.reject(new Error("response lost")) : json({ id, replayed: true });
      }
      return json({ inquiries: [], nextCursor: null });
    });
    render(<InquiryScreen locale="ko" />);
    fireEvent.click(screen.getByRole("button", { name: "새 문의" }));
    fireEvent.change(screen.getByLabelText("제목"), { target: { value: " 예약 확인 " } });
    fireEvent.change(screen.getByLabelText("문의 내용"), { target: { value: " 내 예약을 확인해 주세요. " } });
    fireEvent.click(screen.getByRole("button", { name: "문의 보내기" }));
    await screen.findByText(/전송을 확인하지 못했어요/);
    expect(screen.getByLabelText("문의 내용")).toHaveValue(" 내 예약을 확인해 주세요. ");
    fireEvent.click(screen.getByRole("button", { name: "문의 보내기" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/my/inquiries/${id}?locale=ko`));
    expect(posts).toHaveLength(2);
    expect(posts[0]).toEqual(posts[1]);
    expect(posts[0]).toMatchObject({ subject: "예약 확인", body: "내 예약을 확인해 주세요.", locale: "ko" });
  });
  it("validates whitespace without sending and names the invalid field", async () => {
    fetcher.mockImplementation(() => json({ inquiries: [], nextCursor: null }));
    render(<InquiryScreen locale="ko" />);
    fireEvent.click(screen.getByRole("button", { name: "새 문의" }));
    fireEvent.change(screen.getByLabelText("제목"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("문의 내용"), { target: { value: "문의합니다" } });
    fireEvent.submit(screen.getByRole("button", { name: "문의 보내기" }).closest("form")!);
    expect(screen.getByLabelText("제목")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("제목")).toHaveFocus();
    expect(fetcher.mock.calls.every((call) => call[1]?.method !== "POST")).toBe(true);
  });
  it("shows history and sends a follow-up to reopen a resolved inquiry", async () => {
    let posted = false;
    fetcher.mockImplementation((_url: string, options?: RequestInit) => {
      if (options?.method === "POST") { posted = true; return json({ id: messageId, replayed: false }); }
      return json({ ...detail, inquiry: { ...inquiry, status: posted ? "open" : "resolved", version: posted ? 2 : 1 } });
    });
    render(<InquiryScreen locale="en" id={id} />);
    await screen.findByText("Resolved");
    expect(screen.getByText(message.body)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "One more question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("Message sent.");
    await screen.findByText("Received");
    expect(screen.getByLabelText("Message")).toHaveValue("");
    expect(fetcher).toHaveBeenCalledWith(`/api/me/inquiries/${id}/messages`, expect.objectContaining({ method: "POST", body: expect.stringContaining("One more question") }));
  });
  it("loads earlier history and removes the history button at the beginning", async () => {
    fetcher.mockImplementation((url: string) => json(url.includes("cursor=") ? { ...detail, messages: [{ ...message, id, body: "오래된 문의", createdAt: "2026-09-10T10:00:00.000Z" }], nextCursor: null } : { ...detail, nextCursor: "older-cursor" }));
    render(<InquiryScreen locale="ko" id={id} />);
    fireEvent.click(await screen.findByRole("button", { name: "이전 메시지 보기" }));
    await screen.findByText("오래된 문의");
    expect(screen.getByText(message.body)).toBeVisible();
    expect(screen.queryByRole("button", { name: "이전 메시지 보기" })).not.toBeInTheDocument();
  });
  it("keeps intermediate history reachable when over 50 new messages move the latest page", async () => {
    let advanced = false;
    const newer = Array.from({ length: 50 }, (_, index) => ({ ...message,
      id: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`, body: `새 답변 ${index}`,
      sender: "admin", createdAt: `2026-09-12T12:00:${String(index).padStart(2, "0")}.000Z`,
    }));
    fetcher.mockImplementation((url: string) => {
      if (url.includes("cursor=")) return json({ ...detail, messages: [{ ...message, id, body: advanced ? "중간 대화" : "최초 대화" }], nextCursor: null });
      return json({ ...detail, messages: advanced ? newer : [message], nextCursor: advanced ? "gap-cursor" : "initial-cursor" });
    });
    render(<InquiryScreen locale="ko" id={id} />);
    fireEvent.click(await screen.findByRole("button", { name: "이전 메시지 보기" }));
    await screen.findByText("최초 대화");
    advanced = true;
    fireEvent.click(screen.getByRole("button", { name: "새로고침" }));
    await screen.findByText("새 답변 49");
    fireEvent.click(screen.getByRole("button", { name: "이전 메시지 보기" }));
    await screen.findByText("중간 대화");
    expect(fetcher).toHaveBeenCalledWith(`/api/me/inquiries/${id}?cursor=gap-cursor`, expect.anything());
  });
  it("clears draft, old history and delayed send responses when switching owners", async () => {
    let finish!: (response: Response) => void;
    fetcher.mockImplementation((_url: string, options?: RequestInit) => options?.method === "POST"
      ? new Promise<Response>((resolve) => { finish = resolve; })
      : options?.headers && (options.headers as Record<string, string>).Authorization === "Bearer token-b"
        ? json({ error: { code: "CS_NOT_FOUND" } }, 404) : json(detail));
    const view = render(<InquiryScreen locale="ko" id={id} />);
    await screen.findByText(message.body);
    fireEvent.change(screen.getByLabelText("메시지"), { target: { value: "이전 계정 초안" } });
    fireEvent.click(screen.getByRole("button", { name: "메시지 보내기" }));
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    auth.user = { id: "fan-b" }; auth.getAccessToken.mockResolvedValue("token-b");
    view.rerender(<InquiryScreen locale="ko" id={id} />);
    expect(screen.queryByText(message.body)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("이전 계정 초안")).not.toBeInTheDocument();
    finish(new Response(JSON.stringify({ id: messageId, replayed: false })));
    await screen.findByText("문의를 찾을 수 없어요.");
    expect(screen.queryByText("메시지를 보냈어요.")).not.toBeInTheDocument();
  });
  it("does not send an old draft with a token obtained after an owner change", async () => {
    let releaseToken!: (token: string) => void;
    const view = render(<InquiryScreen locale="ko" id={id} />);
    await screen.findByText(message.body);
    auth.getAccessToken.mockImplementationOnce(() => new Promise<string>((resolve) => { releaseToken = resolve; }));
    fireEvent.change(screen.getByLabelText("메시지"), { target: { value: "old draft" } });
    fireEvent.click(screen.getByRole("button", { name: "메시지 보내기" }));
    auth.user = { id: "fan-b" };
    view.rerender(<InquiryScreen locale="ko" id={id} />);
    releaseToken("token-b");
    await waitFor(() => expect(screen.queryByDisplayValue("old draft")).not.toBeInTheDocument());
    expect(fetcher.mock.calls.some((call) => call[1]?.method === "POST")).toBe(false);
  });
  it("lets a viewer read but not compose or resolve", async () => {
    adminSession.value.admin.role = "viewer";
    render(<AdminInquiryScreen locale="en" id={id} />);
    await screen.findByText(message.body);
    expect(screen.getByText(/You have read-only access/)).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark as resolved" })).not.toBeInTheDocument();
  });
  it("uses the read version to resolve and refreshes a stale conversation", async () => {
    fetcher.mockImplementation((_url: string, options?: RequestInit) => options?.method === "POST" ? json({ error: { code: "CS_STALE_VERSION" } }, 409) : json(detail));
    render(<AdminInquiryScreen locale="ko" id={id} />);
    fireEvent.click(await screen.findByRole("button", { name: "처리 완료하기" }));
    await screen.findByText(/새 메시지나 상태 변경이 있어요/);
    expect(fetcher).toHaveBeenCalledWith(`/api/admin/inquiries/${id}/resolve`, expect.objectContaining({ body: JSON.stringify({ expectedVersion: 1 }) }));
    expect(screen.queryByText("문의를 처리 완료했어요.")).not.toBeInTheDocument();
  });
});
