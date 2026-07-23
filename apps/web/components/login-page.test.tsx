import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./login-page";

const login = vi.fn();
const replace = vi.fn();
const back = vi.fn();
let onComplete: (() => void) | undefined;
let onError: (() => void) | undefined;
const getAccessToken = vi.fn();
let authenticated = false;
let query = "returnTo=%2Flive%2Fkara-nualeaf&intent=reserve";

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated, getAccessToken }),
  useLogin: (callbacks: { onComplete?: () => void; onError?: () => void }) => {
    onComplete = callbacks.onComplete;
    onError = callbacks.onError;
    return { login };
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back, replace }),
  useSearchParams: () => new URLSearchParams(query),
}));

describe("Privy login page", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    login.mockClear(); replace.mockClear(); back.mockClear();
    authenticated = false;
    query = "returnTo=%2Flive%2Fkara-nualeaf&intent=reserve";
    getAccessToken.mockResolvedValue("privy-access-token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ profile: { completed: true, nickname: "John" } }));
    vi.mocked(globalThis.fetch).mockClear();
  });

  it("starts the real Privy modal with Google as the only login method", () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: /Google로 계속하기/ }));
    expect(login).toHaveBeenCalledWith({ loginMethods: ["google"] });
    expect(screen.getByText("로그인 후 선택한 라이브 예약 화면으로 돌아갑니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Test Account 이메일/ })).not.toBeInTheDocument();
  });

  it("uses Privy's email OTP UI only when the non-production Test Account path is enabled", () => {
    render(<LoginPage testAccountLoginEnabled />);
    fireEvent.click(screen.getByRole("button", { name: /Test Account 이메일로 계속하기/ }));
    expect(login).toHaveBeenCalledWith({ loginMethods: ["email"] });
    expect(screen.getByText(/Privy 대시보드에 등록된 Test Account 이메일과 OTP/)).toBeInTheDocument();
  });

  it("renders an accessible contextual overlay and closes back to its preserved background", async () => {
    render(<LoginPage presentation="overlay" />);

    const dialog = await screen.findByRole("dialog", { name: "최애와 함께한 순간을 기록하세요." });
    expect(dialog).toHaveAttribute("aria-describedby", "login-description");
    const closeButton = screen.getByRole("button", { name: "로그인 창 닫기" });
    await waitFor(() => expect(closeButton).toHaveFocus());

    fireEvent.keyDown(document, { key: "Escape" });
    expect(back).toHaveBeenCalledOnce();
    expect(screen.queryByRole("link", { name: "홈으로 돌아가기" })).not.toBeInTheDocument();
  });

  it("uses the shared bottom-sheet presentation on mobile viewports", async () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(<LoginPage presentation="overlay" />);
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveAttribute("data-variant", "bottom-sheet"));
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
    finishSync?.(Response.json({ profile: { completed: true, nickname: "John" } }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/live/kara-nualeaf"));
    expect(fetch).toHaveBeenCalledWith("/api/auth/session", expect.objectContaining({
      method: "POST",
      headers: { authorization: "Bearer privy-access-token" },
    }));
  });

  it("detours only an authenticated user without a profile before restoring the exact intent", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(Response.json({ profile: { completed: false, nickname: null } }));
    render(<LoginPage />);
    onComplete?.();
    await waitFor(() => expect(replace).toHaveBeenCalledWith(
      "/onboarding/profile?returnTo=%2Flive%2Fkara-nualeaf&locale=ko&intent=reserve",
    ));
  });

  it("preserves the durable intent identifier through profile onboarding", async () => {
    query = "returnTo=%2Flive%2Fkara-nualeaf%3Flocale%3Dko%26authIntent%3D11111111-1111-4111-8111-111111111111%23fan-code&intent=attendance&entity=kara-nualeaf&authIntent=11111111-1111-4111-8111-111111111111";
    vi.mocked(globalThis.fetch).mockResolvedValue(Response.json({ profile: { completed: false, nickname: null } }));
    render(<LoginPage />);
    onComplete?.();
    await waitFor(() => expect(replace).toHaveBeenCalledWith(expect.stringContaining("authIntent=11111111-1111-4111-8111-111111111111")));
    expect(screen.getByText("로그인 후 입력한 Fan Code 출석 인증을 이어갑니다.")).toBeInTheDocument();
  });

  it("keeps the contextual login open and recoverable after an OAuth error", async () => {
    render(<LoginPage presentation="overlay" />);
    onError?.();
    expect(await screen.findByRole("alert")).toHaveTextContent("로그인을 완료하지 못했어요");
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(replace).not.toHaveBeenCalled();
  });
});
