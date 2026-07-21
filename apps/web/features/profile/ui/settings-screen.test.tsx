import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsScreen } from "./settings-screen";

const replace = vi.fn();
const router = { replace };
const getAccessToken = vi.fn().mockResolvedValue("access-token");

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: true, getAccessToken }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const settings = {
  nickname: "Kamilia",
  wallet: { chainId: 91342, maskedAddress: "0x1234…cdef" },
};
const preferences = {
  liveReminders: true,
  surveyReminders: false,
  benefitNotifications: true,
  browserSubscription: "unsubscribed" as const,
};

describe("FAN-020 settings", () => {
  beforeEach(() => {
    replace.mockClear();
    getAccessToken.mockClear();
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
