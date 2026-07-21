import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./login-page";

const login = vi.fn();
const replace = vi.fn();
let onComplete: (() => void) | undefined;
const getAccessToken = vi.fn();
let authenticated = false;

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated, getAccessToken }),
  useLogin: (callbacks: { onComplete?: () => void }) => {
    onComplete = callbacks.onComplete;
    return { login };
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams("returnTo=%2Flive%2Fkara-nualeaf&intent=reserve"),
}));

describe("Privy login page", () => {
  beforeEach(() => {
    login.mockClear(); replace.mockClear();
    authenticated = false;
    getAccessToken.mockResolvedValue("privy-access-token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    vi.mocked(globalThis.fetch).mockClear();
  });

  it("starts the real Privy modal with Google as the only login method", () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: /Google로 계속하기/ }));
    expect(login).toHaveBeenCalledWith({ loginMethods: ["google"] });
    expect(screen.getByText("로그인 후 선택한 라이브 예약 화면으로 돌아갑니다.")).toBeInTheDocument();
  });

  it("syncs the verified Privy session before resuming the sanitized route", async () => {
    render(<LoginPage />);
    onComplete?.();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/live/kara-nualeaf"));
    expect(fetch).toHaveBeenCalledWith("/api/auth/session", expect.objectContaining({
      method: "POST",
      headers: { authorization: "Bearer privy-access-token" },
    }));
  });

  it("syncs an existing authenticated Privy session before redirecting", async () => {
    let finishSync: ((response: Response) => void) | undefined;
    vi.mocked(globalThis.fetch).mockImplementation(() => new Promise((resolve) => { finishSync = resolve; }));
    authenticated = true;
    render(<LoginPage />);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalled();
    finishSync?.(new Response(null, { status: 204 }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/live/kara-nualeaf"));
    expect(fetch).toHaveBeenCalledWith("/api/auth/session", expect.objectContaining({
      method: "POST",
      headers: { authorization: "Bearer privy-access-token" },
    }));
  });
});
