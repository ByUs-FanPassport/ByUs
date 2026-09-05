import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./login-page";

const login = vi.fn();
const replace = vi.fn();
const back = vi.fn();
let onComplete: (() => void) | undefined;
let onError: (() => void) | undefined;
const getAccessToken = vi.fn();
let authenticated = false;
let ready = true;
let query = "returnTo=%2Flive%2Fkara-nualeaf&intent=reserve";

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready, authenticated, getAccessToken }),
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
    ready = true;
    query = "returnTo=%2Flive%2Fkara-nualeaf&intent=reserve";
    getAccessToken.mockResolvedValue("privy-access-token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ profile: { completed: true, nickname: "John" } }));
    vi.mocked(globalThis.fetch).mockClear();
  });

  it("returns a completed Google session to MY with locale and intent intact", async () => {
    query = "returnTo=%2Fmy%3Flocale%3Dko%26authIntent%3D11111111-1111-4111-8111-111111111111&locale=ko&intent=passport&entity=collection";
    render(<LoginPage />);
    await act(async () => { await onComplete?.(); });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/my?locale=ko&authIntent=11111111-1111-4111-8111-111111111111"));
  });

  it("starts the real Privy modal with Google as the only login method", () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: /Google로 계속하기/ }));
    expect(login).toHaveBeenCalledWith({ loginMethods: ["google"] });
    expect(screen.queryByText(/Embedded Wallet과 Fan Passport/)).not.toBeInTheDocument();
    expect(screen.queryByText(/로그인 후 .* 돌아갑니다/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Test Account 이메일/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "최애와 함께한 순간을 기록하세요." }).closest("[data-fan-surface]")).toHaveAttribute("lang", "ko");
    expect(screen.getByText("© 2026 Sallylab Inc.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "개인정보처리방침 열기" })).toHaveAttribute("href", "/privacy?locale=ko");
    expect(screen.getByRole("link", { name: "이용약관 열기" })).toHaveAttribute("href", "/terms?locale=ko");
    expect(document.querySelector("picture[data-decorative-background] img")).toHaveAttribute("alt", "");
    expect(screen.getByRole("img", { name: "펼쳐진 Fan Passport" })).toBeInTheDocument();
    expect(document.querySelector("[data-login-layout='passport-gateway']")).toBeInTheDocument();
    expect(screen.getByText("YOUR FAN PASSPORT")).toBeInTheDocument();
  });

  it("shows only a neutral loading state while Privy restores authentication", () => {
    ready = false;
    render(<LoginPage />);

    expect(screen.getByText("로그인 상태를 확인하고 있어요.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Google로 계속하기/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "최애와 함께한 순간을 기록하세요." })).not.toBeInTheDocument();
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
    expect(dialog).not.toHaveAttribute("aria-describedby");
    expect(screen.getByRole("heading", { name: "최애와 함께한 순간을 기록하세요." }).closest("[data-fan-surface]")).toHaveAttribute("lang", "ko");
    const closeButton = screen.getByRole("button", { name: "로그인 창 닫기" });
    await waitFor(() => expect(closeButton).toHaveFocus());

    fireEvent.keyDown(document, { key: "Escape" });
    expect(back).toHaveBeenCalledOnce();
    expect(screen.queryByText("© 2026 Sallylab Inc.")).not.toBeInTheDocument();
    expect(document.querySelector("picture")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "펼쳐진 Fan Passport" })).not.toBeInTheDocument();
    expect(document.querySelector("[data-login-layout='passport-gateway']")).not.toBeInTheDocument();
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
    expect(screen.getByText("로그인 상태를 연결하고 있어요.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Google로 계속하기/ })).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    finishSync?.(Response.json({ profile: { completed: true, nickname: "John" } }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/live/kara-nualeaf"));
    expect(fetch).toHaveBeenCalledWith("/api/auth/session", expect.objectContaining({
      method: "POST",
      headers: { authorization: "Bearer privy-access-token" },
    }));
  });

  it("keeps an authenticated session error recoverable without showing Google login", async () => {
    authenticated = true;
    vi.mocked(globalThis.fetch)
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(Response.json({ profile: { completed: true, nickname: "John" } }));

    render(<LoginPage />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("로그인 정보를 안전하게 연결하지 못했어요.");
    expect(screen.queryByRole("button", { name: /Google로 계속하기/ })).not.toBeInTheDocument();
    await waitFor(() => expect(alert.parentElement).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/live/kara-nualeaf"));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("restores a non-verification intent without forcing profile onboarding", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(Response.json({ profile: { completed: false, nickname: null } }));
    render(<LoginPage />);
    onComplete?.();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/live/kara-nualeaf"));
  });

  it("does not nest an existing onboarding return path", async () => {
    query = "returnTo=%2Fonboarding%2Fprofile%3FreturnTo%3D%252Flive%252Fkara-nualeaf%26locale%3Dko&locale=ko";
    vi.mocked(globalThis.fetch).mockResolvedValue(Response.json({ profile: { completed: false, nickname: null } }));
    render(<LoginPage />);
    onComplete?.();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/?locale=ko"));
  });

  it("preserves a non-verification durable intent while returning to its source", async () => {
    query = "returnTo=%2Flive%2Fkara-nualeaf%3Flocale%3Dko%26authIntent%3D11111111-1111-4111-8111-111111111111%23fan-code&intent=attendance&entity=kara-nualeaf&authIntent=11111111-1111-4111-8111-111111111111";
    vi.mocked(globalThis.fetch).mockResolvedValue(Response.json({ profile: { completed: false, nickname: null } }));
    render(<LoginPage />);
    onComplete?.();
    await waitFor(() => expect(replace).toHaveBeenCalledWith(
      "/live/kara-nualeaf?locale=ko&authIntent=11111111-1111-4111-8111-111111111111#fan-code",
    ));
    expect(screen.queryByText(/Fan Code 출석 인증을 이어갑니다/)).not.toBeInTheDocument();
  });

  it("inserts profile onboarding only for a fan verification intent", async () => {
    query = "returnTo=%2Fc%2Fkara%2Fverify&intent=passport&entity=kara&locale=ko";
    vi.mocked(globalThis.fetch).mockResolvedValue(Response.json({ profile: { completed: false, nickname: null } }));
    render(<LoginPage />);
    onComplete?.();
    await waitFor(() => expect(replace).toHaveBeenCalledWith(
      "/onboarding/profile?returnTo=%2Fc%2Fkara%2Fverify&locale=ko&intent=passport&entity=kara",
    ));
  });

  it("keeps the contextual login open and recoverable after an OAuth error", async () => {
    render(<LoginPage presentation="overlay" />);
    await act(async () => {
      onError?.();
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("로그인을 완료하지 못했어요");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(replace).not.toHaveBeenCalled();
  });
});
