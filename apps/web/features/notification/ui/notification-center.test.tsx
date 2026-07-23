import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { authState, getAccessToken, enablePushNotifications } = vi.hoisted(() => ({
  authState: { ready: true, authenticated: true },
  getAccessToken: vi.fn(async () => "token"),
  enablePushNotifications: vi.fn(
    async (): Promise<"subscribed" | "denied" | "unsupported" | "failed"> =>
      "subscribed",
  ),
}));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ...authState, getAccessToken }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("./push-subscription", () => ({ enablePushNotifications }));
import { NotificationCenter } from "./notification-center";

describe("FAN-019 Notification Center", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.ready = true;
    authState.authenticated = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ notifications: [], unreadCount: 0 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    window.history.replaceState({}, "", "/notifications");
  });
  it("does not request push permission on visit and only starts after explicit activation", async () => {
    render(<NotificationCenter />);
    expect(enablePushNotifications).not.toHaveBeenCalled();
    expect(
      await screen.findByText("아직 도착한 알림이 없습니다."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getAllByRole("button", { name: "브라우저 알림 켜기" })[0],
    );
    await waitFor(() =>
      expect(enablePushNotifications).toHaveBeenCalledTimes(1),
    );
    expect(enablePushNotifications).toHaveBeenCalledWith(getAccessToken);
  });
  it("renders authenticated notification deep links and unread state", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          notifications: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              kind: "live_10m",
              title: "KARA LIVE, 10분 후 시작해요",
              detail: "곧 라이브가 시작됩니다.",
              createdAt: new Date().toISOString(),
              readAt: null,
              deepLink: "/live/kara-live",
            },
            {
              id: "33333333-3333-4333-8333-333333333333",
              kind: "benefit_available",
              title: "팬 혜택 신청이 완료되었어요",
              detail: "신청 내역에서 진행 상태를 확인하세요.",
              createdAt: new Date().toISOString(),
              readAt: new Date().toISOString(),
              deepLink: "/benefits/44444444-4444-4444-8444-444444444444",
            },
          ],
          unreadCount: 1,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    render(<NotificationCenter />);
    const link = await screen.findByRole("link", {
      name: /KARA LIVE, 10분 후 시작해요/,
    });
    expect(link).toHaveAttribute("href", "/live/kara-live");
    expect(screen.getByText("읽지 않음")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "MY" })).toHaveLength(2);
    for (const currentLink of screen.getAllByRole("link", { name: "MY" })) {
      expect(currentLink).toHaveAttribute("aria-current", "page");
    }
    expect(link).toHaveAttribute("data-read-state", "unread");
    expect(
      screen.getByRole("link", { name: /팬 혜택 신청이 완료되었어요/ }),
    ).toHaveAttribute("data-read-state", "read");
    expect(screen.getByText("읽음")).toBeInTheDocument();
  });

  it("renders a clear hierarchy without the repeated uppercase eyebrow", async () => {
    render(<NotificationCenter />);
    expect(
      await screen.findByRole("heading", { name: "아직 도착한 알림이 없습니다." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "알림", level: 1 })).toBeInTheDocument();
    expect(screen.queryByText("Notification Center")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "알림 설정 열기" })).toHaveAttribute(
      "href",
      "/settings?locale=ko",
    );
    expect(screen.getByRole("link", { name: "다가오는 LIVE 보기" })).toHaveAttribute(
      "href",
      "/live?locale=ko",
    );
  });

  it("exposes a useful sign-in state without requesting notification data", async () => {
    authState.authenticated = false;
    render(<NotificationCenter />);
    expect(
      await screen.findByRole("heading", { name: "로그인 후 알림을 확인해 주세요." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "로그인하기" })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fnotifications",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("offers a retry action after a collection error", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ notifications: [], unreadCount: 0 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    render(<NotificationCenter />);
    expect(
      await screen.findByRole("heading", { name: "알림을 불러오지 못했습니다." }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(
      await screen.findByRole("heading", { name: "아직 도착한 알림이 없습니다." }),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["denied", "브라우저 설정에서 알림 권한을 허용해 주세요."],
    ["unsupported", "이 브라우저는 푸시 알림을 지원하지 않습니다."],
    ["failed", "알림 설정을 저장하지 못했습니다."],
  ] as const)("announces the %s push result", async (result, message) => {
    enablePushNotifications.mockResolvedValueOnce(result);
    render(<NotificationCenter />);
    await screen.findByText("아직 도착한 알림이 없습니다.");
    fireEvent.click(
      screen.getAllByRole("button", { name: "브라우저 알림 켜기" })[0],
    );
    expect(await screen.findByRole("status")).toHaveTextContent(message);
  });
});
