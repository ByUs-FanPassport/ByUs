import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { authState, getAccessToken, enablePushNotifications } = vi.hoisted(() => ({
  authState: { ready: true, authenticated: true, user: { id: "owner-a" } },
  getAccessToken: vi.fn<() => Promise<string | null>>(async () => "token"),
  enablePushNotifications: vi.fn<
    (getToken: () => Promise<string | null>) => Promise<"subscribed" | "denied" | "unsupported" | "failed">
  >(
    async (): Promise<"subscribed" | "denied" | "unsupported" | "failed"> =>
      "subscribed",
  ),
}));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ...authState, getAccessToken }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/notifications",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("./push-subscription", () => ({ enablePushNotifications }));
import { NotificationCenter } from "./notification-center";

const unreadCollection = {
  notifications: [{
    id: "22222222-2222-4222-8222-222222222222",
    kind: "live_10m",
    title: "KARA LIVE, 10분 후 시작해요",
    detail: "곧 라이브가 시작됩니다.",
    createdAt: "2026-09-04T08:12:34.000+00:00",
    readAt: null,
    deepLink: "/live/kara-live",
  }],
  unreadCount: 1,
};

describe("FAN-019 Notification Center", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.ready = true;
    authState.authenticated = true;
    authState.user = { id: "owner-a" };
    getAccessToken.mockReset().mockResolvedValue("token");
    enablePushNotifications.mockReset().mockResolvedValue("subscribed");
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
    expect(enablePushNotifications).toHaveBeenCalledWith(expect.any(Function));
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
              createdAt: "2026-09-04T08:12:34.000+00:00",
              readAt: null,
              deepLink: "/live/kara-live",
            },
            {
              id: "33333333-3333-4333-8333-333333333333",
              kind: "benefit_available",
              title: "팬 혜택 신청이 완료되었어요",
              detail: "신청 내역에서 진행 상태를 확인하세요.",
              createdAt: "2026-09-04T07:12:34.000+00:00",
              readAt: "2026-09-04T07:22:34.000+00:00",
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
    const currentMyLinks = screen.getAllByRole("link", { name: "MY" }).filter((link) => link.hasAttribute("aria-current"));
    expect(currentMyLinks).toHaveLength(2);
    for (const currentLink of currentMyLinks) {
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
    expect(screen.getByRole("link", { name: "Google로 계속하기" })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fnotifications%3Flocale%3Dko&locale=ko",
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
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("guards read-all before a delayed token and shows a pending label", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(unreadCollection));
    render(<NotificationCenter />);
    await screen.findByText("KARA LIVE, 10분 후 시작해요");
    let resolveToken!: (token: string) => void;
    getAccessToken.mockImplementationOnce(() => new Promise((resolve) => { resolveToken = resolve; }));

    const button = screen.getByRole("button", { name: "모두 읽음" });
    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "모두 읽는 중…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "모두 읽는 중…" }));
    resolveToken("delayed-token");

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([url]) =>
      String(url) === "/api/notifications/read-all",
    )).toHaveLength(1));
  });

  it.each(["token", "http", "network"] as const)("announces read-all %s errors and allows retry", async (kind) => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(unreadCollection));
    render(<NotificationCenter />);
    await screen.findByText("KARA LIVE, 10분 후 시작해요");
    if (kind === "token") getAccessToken.mockResolvedValueOnce(null);
    if (kind === "http") vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    if (kind === "network") vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));

    fireEvent.click(screen.getByRole("button", { name: "모두 읽음" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("알림을 모두 읽음으로 표시하지 못했습니다. 다시 시도해 주세요.");
    expect(screen.getByRole("button", { name: "모두 읽음" })).toBeEnabled();
  });

  it("guards push enablement, shows progress, and reports thrown failures", async () => {
    render(<NotificationCenter />);
    await screen.findByText("아직 도착한 알림이 없습니다.");
    let rejectEnable!: () => void;
    enablePushNotifications.mockImplementationOnce(() => new Promise((_, reject) => {
      rejectEnable = () => reject(new Error("offline"));
    }));

    fireEvent.click(screen.getByRole("button", { name: "브라우저 알림 켜기" }));
    expect(screen.getByRole("button", { name: "알림 켜는 중…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "알림 켜는 중…" }));
    rejectEnable();
    expect(await screen.findByRole("alert")).toHaveTextContent("알림 설정을 저장하지 못했습니다.");
    expect(enablePushNotifications).toHaveBeenCalledTimes(1);
  });

  it("does not send read-all after unmount while its token is pending", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(unreadCollection));
    const view = render(<NotificationCenter />);
    await screen.findByText("KARA LIVE, 10분 후 시작해요");
    let resolveToken!: (token: string) => void;
    getAccessToken.mockImplementationOnce(() => new Promise((resolve) => { resolveToken = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "모두 읽음" }));
    view.unmount();

    await act(async () => {
      resolveToken("late-token");
      await Promise.resolve();
    });
    expect(vi.mocked(fetch).mock.calls.filter(([url]) =>
      String(url) === "/api/notifications/read-all",
    )).toHaveLength(0);
  });

  it("clears the previous owner's notifications before the next owner's GET resolves", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(unreadCollection));
    const view = render(<NotificationCenter />);
    await screen.findByText("KARA LIVE, 10분 후 시작해요");
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => undefined));

    authState.user = { id: "owner-b" };
    view.rerender(<NotificationCenter />);

    expect(screen.queryByText("KARA LIVE, 10분 후 시작해요")).not.toBeInTheDocument();
    expect(screen.getByText("알림을 불러오는 중입니다.")).toBeInTheDocument();
  });

  it("does not let the push helper obtain the next owner's token", async () => {
    let tokenProvider!: () => Promise<string | null>;
    let finishPush!: (result: "failed") => void;
    enablePushNotifications.mockImplementationOnce((provider) => {
      tokenProvider = provider;
      return new Promise((resolve) => { finishPush = resolve; });
    });
    const view = render(<NotificationCenter />);
    await screen.findByText("아직 도착한 알림이 없습니다.");
    fireEvent.click(screen.getByRole("button", { name: "브라우저 알림 켜기" }));
    await waitFor(() => expect(tokenProvider).toBeTypeOf("function"));

    authState.user = { id: "owner-b" };
    view.rerender(<NotificationCenter />);
    const tokenCallsAfterSwitch = getAccessToken.mock.calls.length;
    await expect(tokenProvider()).resolves.toBeNull();
    expect(getAccessToken).toHaveBeenCalledTimes(tokenCallsAfterSwitch);
    finishPush("failed");
  });
});
