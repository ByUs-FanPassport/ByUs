import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { KakaoCallbackScreen, parseKakaoCallbackQuery } from "./kakao-callback-screen";

const { authState, getAccessToken, replace } = vi.hoisted(() => ({
  authState: { ready: true, authenticated: true, user: { id: "privy:owner-a" } as { id: string } | null },
  getAccessToken: vi.fn<() => Promise<string | null>>(),
  replace: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ...authState, getAccessToken }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/settings/kakao/callback",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

function callbackUrl(suffix: string, stateCharacter = "s") {
  return `/settings/kakao/callback?code=${suffix}&state=${stateCharacter.repeat(40)}`;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("Kakao callback landing", () => {
  beforeEach(() => {
    authState.ready = true;
    authState.authenticated = true;
    authState.user = { id: "privy:owner-a" };
    getAccessToken.mockReset();
    getAccessToken.mockResolvedValue("privy-token");
    replace.mockReset();
    vi.restoreAllMocks();
  });

  it("rejects duplicate and bounded-invalid query values", () => {
    expect(parseKakaoCallbackQuery(`code=a&code=b&state=${"s".repeat(40)}`)).toEqual({ kind: "invalid" });
    expect(parseKakaoCallbackQuery(`code=a&state=short`)).toEqual({ kind: "invalid" });
    expect(parseKakaoCallbackQuery(`error=access_denied`)).toEqual({ kind: "provider_error" });
  });

  it("posts exactly once in Strict Mode, clears the address, and returns after success", async () => {
    window.history.replaceState({}, "", callbackUrl("strict-success", "a"));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ returnPath: "/settings?locale=ko" }));
    render(<StrictMode><KakaoCallbackScreen locale="ko" /></StrictMode>);

    expect(window.location.pathname).toBe("/settings/kakao/callback");
    expect(window.location.search).toBe("");
    expect(await screen.findByRole("heading", { name: "Kakao 연결이 완료됐어요." })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/me/connected-accounts/kakao/callback", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer privy-token" }),
      body: JSON.stringify({ code: "strict-success", state: "a".repeat(40) }),
    }));
    expect(replace).toHaveBeenCalledWith("/settings?locale=ko");
  });

  it("waits until Privy is ready and authenticated", async () => {
    authState.ready = false;
    window.history.replaceState({}, "", callbackUrl("wait-ready", "b"));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ returnPath: "/settings" }));
    const view = render(<KakaoCallbackScreen locale="en" />);
    expect(fetchMock).not.toHaveBeenCalled();
    authState.ready = true;
    view.rerender(<KakaoCallbackScreen locale="en" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("does not retain the callback through login when signed out", async () => {
    authState.authenticated = false;
    authState.user = null;
    window.history.replaceState({}, "", callbackUrl("signed-out", "c"));
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const view = render(<KakaoCallbackScreen locale="ko" />);
    expect(await screen.findByRole("heading", { name: /로그인 상태를 확인할 수 없어/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "설정에서 다시 연결하기" })).toHaveAttribute("href", "/settings?locale=ko");
    expect(window.location.search).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
    authState.authenticated = true;
    authState.user = { id: "privy:owner-a" };
    view.rerender(<KakaoCallbackScreen locale="ko" />);
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a restart action when Privy cannot issue a token", async () => {
    getAccessToken.mockResolvedValue(null);
    window.history.replaceState({}, "", callbackUrl("token-error", "d"));
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<KakaoCallbackScreen locale="ko" />);
    expect(await screen.findByRole("heading", { name: /로그인 확인에 실패/ })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("suppresses late success when the authenticated owner changes", async () => {
    window.history.replaceState({}, "", callbackUrl("owner-change", "e"));
    const pending = deferred<Response>();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValue(pending.promise);
    const view = render(<KakaoCallbackScreen locale="ko" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    authState.user = { id: "privy:owner-b" };
    view.rerender(<KakaoCallbackScreen locale="ko" />);
    expect(await screen.findByRole("heading", { name: /계정이 변경됐어요/ })).toBeInTheDocument();
    pending.resolve(Response.json({ returnPath: "/settings" }));
    await Promise.resolve();
    expect(replace).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not post an old callback if the owner changes while a token is pending", async () => {
    window.history.replaceState({}, "", callbackUrl("owner-change-before-post", "h"));
    const token = deferred<string | null>();
    getAccessToken.mockReturnValue(token.promise);
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const view = render(<KakaoCallbackScreen locale="ko" />);
    await waitFor(() => expect(getAccessToken).toHaveBeenCalledTimes(1));
    authState.user = { id: "privy:owner-b" };
    view.rerender(<KakaoCallbackScreen locale="ko" />);
    token.resolve("old-or-new-token");
    expect(await screen.findByRole("heading", { name: /계정이 변경됐어요/ })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["/settings/kakao/callback?code=missing-state", "연결 정보가 없거나 올바르지 않아요."],
    ["/settings/kakao/callback?error=access_denied", "Kakao 연결이 취소됐어요."],
  ])("clears malformed or denied callback parameters: %s", async (url, message) => {
    window.history.replaceState({}, "", url);
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<KakaoCallbackScreen locale="ko" />);
    expect(await screen.findByRole("heading", { name: message })).toBeInTheDocument();
    expect(window.location.search).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not auto-retry an ambiguous callback failure", async () => {
    window.history.replaceState({}, "", callbackUrl("exchange-failure", "f"));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: { code: "KAKAO_CONNECTION_CALLBACK_FAILED" } }, { status: 400 }));
    const view = render(<KakaoCallbackScreen locale="ko" />);
    expect(await screen.findByRole("heading", { name: /연결을 완료하지 못했어요/ })).toBeInTheDocument();
    view.rerender(<KakaoCallbackScreen locale="ko" />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a consumed callback after the single-flight retention expires", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState({}, "", callbackUrl("expired-flight", "i"));
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: { code: "KAKAO_CONNECTION_CALLBACK_FAILED" } }, { status: 400 }));
      const view = render(<KakaoCallbackScreen locale="ko" />);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
      expect(screen.getByRole("heading", { name: /연결을 완료하지 못했어요/ })).toBeInTheDocument();
      await act(async () => { vi.advanceTimersByTime(31_000); });
      authState.ready = false;
      view.rerender(<KakaoCallbackScreen locale="ko" />);
      authState.ready = true;
      view.rerender(<KakaoCallbackScreen locale="ko" />);
      await act(async () => { await Promise.resolve(); });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not post if unmounted while token retrieval is pending", async () => {
    window.history.replaceState({}, "", callbackUrl("unmount", "g"));
    const token = deferred<string | null>();
    getAccessToken.mockReturnValue(token.promise);
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const view = render(<KakaoCallbackScreen locale="ko" />);
    await waitFor(() => expect(getAccessToken).toHaveBeenCalledTimes(1));
    view.unmount();
    token.resolve("token-after-unmount");
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("offers restart after an interrupted return with no callback values", async () => {
    window.history.replaceState({}, "", "/settings/kakao/callback");
    render(<KakaoCallbackScreen locale="en" />);
    expect(await screen.findByRole("heading", { name: "The connection details are missing or invalid." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect again in Settings" })).toHaveAttribute("href", "/settings?locale=en");
  });
});
