import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationMonitor } from "./notification-monitor";

const id = "11111111-1111-4111-8111-111111111111";
const getAccessToken = vi.fn(async () => "token");
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ getAccessToken }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/notifications",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));
let role: "viewer" | "operator" = "operator";
vi.mock("./use-admin-session", () => ({
  useAdminSession: () => ({ status: "authorized", admin: { role } }),
}));

const data = {
  counts: { pending: 0, processing: 0, sent: 0, failed: 1 },
  items: [{
    id, channel: "email", kind: "benefit_won", status: "failed", attemptCount: 2,
    nextAttemptAt: "2026-09-04T00:00:00Z", destinationLabel: "Kakao ••••1234",
    errorCode: "INVALID_RECIPIENT", createdAt: "2026-09-04T00:00:00Z", sentAt: null,
    manuallyRetryable: true,
  }],
};

function retryKeys(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === "POST")
    .map(([, init]) => (init?.headers as Record<string, string>)["idempotency-key"]);
}

describe("notification monitor retry lifecycle", () => {
  beforeEach(() => {
    role = "operator";
    getAccessToken.mockReset();
    getAccessToken.mockResolvedValue("token");
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => `uuid-${Math.random()}`) });
  });

  it("guards duplicate clicks before a delayed token and keeps the key after an uncertain POST failure", async () => {
    let resolveToken!: (token: string) => void;
    getAccessToken
      .mockResolvedValueOnce("token")
      .mockImplementationOnce(() => new Promise((resolve) => { resolveToken = resolve; }))
      .mockResolvedValue("token");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(data))
      .mockRejectedValueOnce(new TypeError("network failed"))
      .mockResolvedValueOnce(Response.json({ delivery: {} }, { status: 202 }))
      .mockResolvedValueOnce(Response.json(data));
    vi.stubGlobal("fetch", fetchMock);
    render(<NotificationMonitor />);
    const button = await screen.findByRole("button", { name: `재시도 ${id}` });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(screen.getByText("알림 전송을 재시도하는 중입니다.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveToken("token");
    expect(await screen.findByRole("alert")).toHaveTextContent("재시도하지 못했습니다");
    fireEvent.click(screen.getByRole("button", { name: `재시도 ${id}` }));
    await waitFor(() => expect(retryKeys(fetchMock)).toHaveLength(2));
    expect(retryKeys(fetchMock)[1]).toBe(retryKeys(fetchMock)[0]);
  });

  it("keeps the same key when POST succeeds but its following GET fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(data))
      .mockResolvedValueOnce(Response.json({ delivery: {} }, { status: 202 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(Response.json(data))
      .mockResolvedValueOnce(Response.json({ delivery: {} }, { status: 202 }))
      .mockResolvedValueOnce(Response.json(data));
    vi.stubGlobal("fetch", fetchMock);
    render(<NotificationMonitor />);
    fireEvent.click(await screen.findByRole("button", { name: `재시도 ${id}` }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    const retry = await screen.findByRole("button", { name: `재시도 ${id}` });
    fireEvent.click(retry);
    await waitFor(() => expect(retryKeys(fetchMock)).toHaveLength(2));
    expect(retryKeys(fetchMock)[1]).toBe(retryKeys(fetchMock)[0]);
  });

  it("uses a new key for a later manually retryable delivery after POST and GET both succeed", async () => {
    const fetchMock = vi.fn(async (_input, init) =>
      init?.method === "POST"
        ? Response.json({ delivery: {} }, { status: 202 })
        : Response.json(data),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<NotificationMonitor />);
    fireEvent.click(await screen.findByRole("button", { name: `재시도 ${id}` }));
    await waitFor(() => expect(retryKeys(fetchMock)).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("button", { name: `재시도 ${id}` })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: `재시도 ${id}` }));
    await waitFor(() => expect(retryKeys(fetchMock)).toHaveLength(2));
    expect(retryKeys(fetchMock)[1]).not.toBe(retryKeys(fetchMock)[0]);
  });

  it("keeps retry disabled for Viewer", async () => {
    role = "viewer";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(data)));
    render(<NotificationMonitor />);
    expect(await screen.findByRole("button", { name: `재시도 ${id}` })).toBeDisabled();
  });

  it("keeps Kakao retry disabled even if a malformed projection marks it retryable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...data, items: [{ ...data.items[0], channel: "kakao" }] })));
    render(<NotificationMonitor />);
    expect(await screen.findByRole("button", { name: `재시도 ${id}` })).toBeDisabled();
  });

  it("labels provider acceptance as awaiting delivery confirmation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...data, items: [{ ...data.items[0], channel: "kakao", providerStatus: "accepted", providerStatusCode: "2000" }] })));
    render(<NotificationMonitor />);
    expect(await screen.findByText("접수 완료 / 배달 확인 중 · 2000")).toBeInTheDocument();
  });
});
