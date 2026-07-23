import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveBrowserPermissionState,
  SettingsScreen,
} from "./settings-screen";

const { enablePushNotifications } = vi.hoisted(() => ({
  enablePushNotifications: vi.fn<
    () => Promise<"subscribed" | "denied" | "unsupported" | "failed">
  >(async () => "subscribed"),
}));

const replace = vi.fn();
const router = { replace };
const getAccessToken = vi.fn().mockResolvedValue("access-token");

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: true, getAccessToken }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../../notification/ui/push-subscription", () => ({
  enablePushNotifications,
}));

const settings = {
  nickname: "Kamilia",
  wallet: { chainId: 91342, maskedAddress: "0x1234…cdef" },
};
let preferences: {
  liveReminders: boolean;
  surveyReminders: boolean;
  benefitNotifications: boolean;
  browserSubscription: "subscribed" | "unsubscribed";
} = {
  liveReminders: true,
  surveyReminders: false,
  benefitNotifications: true,
  browserSubscription: "unsubscribed",
};

function setBrowserCapabilities({
  permission = "default",
  secure = true,
  supported = true,
}: {
  permission?: NotificationPermission;
  secure?: boolean;
  supported?: boolean;
} = {}) {
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: secure,
  });
  if (supported) {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: { permission, requestPermission: vi.fn() },
    });
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: class PushManager {},
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register: vi.fn() },
    });
  } else {
    Reflect.deleteProperty(window, "Notification");
    Reflect.deleteProperty(window, "PushManager");
    Reflect.deleteProperty(navigator, "serviceWorker");
  }
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: false })),
  });
}

describe("FAN-020 settings", () => {
  beforeEach(() => {
    replace.mockClear();
    getAccessToken.mockClear();
    enablePushNotifications.mockReset();
    enablePushNotifications.mockResolvedValue("subscribed");
    preferences = {
      liveReminders: true,
      surveyReminders: false,
      benefitNotifications: true,
      browserSubscription: "unsubscribed",
    };
    setBrowserCapabilities();
    localStorage.clear();
    document.cookie = "byus_locale=; Max-Age=0; Path=/";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/me/settings") return Response.json({ settings });
      if (url === "/api/notifications/preferences" && init?.method === "PATCH")
        return Response.json({
          preferences: { ...preferences, ...JSON.parse(String(init.body)) },
        });
      if (url === "/api/notifications/preferences")
        return Response.json({ preferences });
      if (url === "/api/me/nickname")
        return Response.json({
          profile: { completed: true, nickname: "Melody" },
        });
      throw new Error(`Unexpected URL ${url}`);
    });
  });

  it("maps every browser permission capability without requesting permission", () => {
    const base = {
      secureContext: true,
      hasNotification: true,
      hasPushManager: true,
      hasServiceWorker: true,
    };
    expect(resolveBrowserPermissionState({ ...base, permission: "default" })).toBe(
      "default",
    );
    expect(resolveBrowserPermissionState({ ...base, permission: "granted" })).toBe(
      "granted",
    );
    expect(resolveBrowserPermissionState({ ...base, permission: "denied" })).toBe(
      "denied",
    );
    expect(
      resolveBrowserPermissionState({ ...base, secureContext: false }),
    ).toBe("insecure");
    expect(
      resolveBrowserPermissionState({ ...base, hasNotification: false }),
    ).toBe("unsupported");
  });

  it("shows default permission and unsubscribed states before explicit activation", async () => {
    render(<SettingsScreen locale="ko" />);
    expect(
      await screen.findByText("아직 알림 권한을 요청하지 않았어요."),
    ).toBeInTheDocument();
    expect(screen.getByText("등록된 브라우저 알림이 없어요.")).toBeInTheDocument();
    expect(enablePushNotifications).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "브라우저 알림 연결" }),
    ).toBeInTheDocument();
  });

  it("never repeats the browser prompt after permission is denied", async () => {
    setBrowserCapabilities({ permission: "denied" });
    render(<SettingsScreen locale="ko" />);
    expect(
      await screen.findByText("브라우저 설정에서 알림 권한을 허용해 주세요."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "브라우저 알림 연결" }),
    ).not.toBeInTheDocument();
    expect(enablePushNotifications).not.toHaveBeenCalled();
  });

  it.each([
    [false, true, "보안 연결(HTTPS)에서만 브라우저 알림을 사용할 수 있어요."],
    [true, false, "이 브라우저는 푸시 알림을 지원하지 않습니다."],
  ])(
    "renders unavailable capability states without a fake connect action",
    async (secure, supported, expected) => {
      setBrowserCapabilities({ secure, supported });
      render(<SettingsScreen locale="ko" />);
      expect(await screen.findByText(expected)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "브라우저 알림 연결" }),
      ).not.toBeInTheDocument();
    },
  );

  it("distinguishes granted permission, pending connection, error, and subscribed", async () => {
    setBrowserCapabilities({ permission: "granted" });
    let resolvePush: (value: "subscribed" | "failed") => void = () => {};
    enablePushNotifications.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePush = resolve;
        }),
    );
    render(<SettingsScreen locale="ko" />);
    expect(
      await screen.findByText("알림 권한이 허용되어 있어요."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "현재 브라우저 연결" }),
    );
    expect(await screen.findByText("브라우저 알림을 연결하는 중이에요.")).toBeInTheDocument();
    resolvePush("failed");
    expect(
      await screen.findByText(
        "브라우저 알림을 연결하지 못했어요. 다시 시도해 주세요.",
      ),
    ).toBeInTheDocument();

    enablePushNotifications.mockResolvedValue("subscribed");
    fireEvent.click(
      screen.getByRole("button", { name: "현재 브라우저 연결" }),
    );
    expect(
      await screen.findByText("등록된 브라우저 알림이 있어요."),
    ).toBeInTheDocument();
  });

  it("keeps account subscription status separate from this browser's permission", async () => {
    preferences = { ...preferences, browserSubscription: "subscribed" };
    setBrowserCapabilities({ permission: "default" });
    render(<SettingsScreen locale="ko" />);
    expect(
      await screen.findByText("아직 알림 권한을 요청하지 않았어요."),
    ).toBeInTheDocument();
    expect(screen.getByText("등록된 브라우저 알림이 있어요.")).toBeInTheDocument();
  });

  it("moves PWA installation from available to pending and only marks installed on appinstalled", async () => {
    render(<SettingsScreen locale="ko" />);
    await screen.findByRole("heading", { name: "설정" });
    const prompt = vi.fn().mockResolvedValue(undefined);
    const installEvent = Object.assign(new Event("beforeinstallprompt"), {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    });
    fireEvent(window, installEvent);
    fireEvent.click(
      await screen.findByRole("button", { name: "ByUs 설치하기" }),
    );
    expect(await screen.findByText("설치 요청 확인 중…")).toBeInTheDocument();
    expect(screen.queryByText("이 기기에 설치됨")).not.toBeInTheDocument();
    fireEvent(window, new Event("appinstalled"));
    expect(await screen.findByText("이 기기에 설치됨")).toBeInTheDocument();
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("shows PWA unsupported and install error states truthfully", async () => {
    const view = render(<SettingsScreen locale="ko" />);
    expect(
      await screen.findByText("브라우저 메뉴의 ‘홈 화면에 추가’를 이용해 주세요."),
    ).toBeInTheDocument();

    const installEvent = Object.assign(new Event("beforeinstallprompt"), {
      prompt: vi.fn().mockRejectedValue(new Error("prompt failed")),
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    });
    fireEvent(window, installEvent);
    fireEvent.click(
      await screen.findByRole("button", { name: "ByUs 설치하기" }),
    );
    expect(
      await screen.findByText(
        "설치 요청을 열지 못했어요. 브라우저 메뉴를 이용해 주세요.",
      ),
    ).toBeInTheDocument();
    view.unmount();

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
    render(<SettingsScreen locale="ko" />);
    expect(await screen.findByText("이 기기에 설치됨")).toBeInTheDocument();
  });

  it("shows only the masked immutable Privy wallet and has no withdrawal control", async () => {
    render(<SettingsScreen locale="ko" />);
    expect(
      await screen.findByRole("heading", { name: "설정" }),
    ).toBeInTheDocument();
    expect(screen.getByText("0x1234…cdef")).toBeInTheDocument();
    expect(screen.queryByText(/0x[0-9a-f]{40}/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /출금|withdraw/i }),
    ).not.toBeInTheDocument();
  });

  it("renames the profile with PUT and preserves wallet presentation", async () => {
    render(<SettingsScreen locale="ko" />);
    await screen.findByText("Kamilia");
    fireEvent.click(screen.getByRole("button", { name: "변경" }));
    fireEvent.change(screen.getByRole("textbox", { name: "닉네임" }), {
      target: { value: "Melody" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/me/nickname",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ nickname: "Melody" }),
        }),
      ),
    );
    expect(
      await screen.findByText("변경 사항을 저장했어요."),
    ).toBeInTheDocument();
    expect(screen.getByText("0x1234…cdef")).toBeInTheDocument();
  });

  it("persists language and integrates the notification preference contract", async () => {
    render(<SettingsScreen locale="ko" />);
    await screen.findByRole("heading", { name: "설정" });
    expect(localStorage.getItem("byus:locale")).toBe("ko");
    fireEvent.click(screen.getByRole("switch", { name: "설문 참여 알림" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/notifications/preferences",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ surveyReminders: true }),
        }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(replace).toHaveBeenCalledWith("/settings?locale=en");
  });
});
