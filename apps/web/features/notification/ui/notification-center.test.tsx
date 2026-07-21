import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { getAccessToken, enablePushNotifications } = vi.hoisted(() => ({
  getAccessToken: vi.fn(async () => "token"),
  enablePushNotifications: vi.fn(async () => "subscribed" as const),
}));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: true, getAccessToken }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("./push-subscription", () => ({ enablePushNotifications }));
import { NotificationCenter } from "./notification-center";

describe("FAN-019 Notification Center", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });
});
