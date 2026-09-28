import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MyScreen } from "./my-screen";
import { readAuthIntent } from "../../../components/auth-intent";
const push = vi.fn();
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: false, getAccessToken: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/my", useSearchParams: () => new URLSearchParams() }));
beforeEach(() => { push.mockClear(); sessionStorage.clear(); });
it.each([["ko", "로그인하기"], ["en", "Sign in"], ["ja", "ログイン"], ["zh-Hans", "登录"], ["zh-Hant", "登入"], ["es", "Iniciar sesión"], ["id", "Masuk"], ["vi", "Đăng nhập"], ["th", "ลงชื่อเข้าใช้"], ["pt", "Entrar"], ["fr", "Se connecter"]] as const)("opens login from the provider-neutral MY CTA and preserves the %s return destination", (locale, label) => {
  render(<MyScreen locale={locale} />);
  fireEvent.click(screen.getByRole("link", { name: label }));
  expect(push).toHaveBeenCalledTimes(1);
  const destination = new URL(push.mock.calls[0][0], "http://localhost");
  expect(destination.pathname).toBe("/login");
  const intent = readAuthIntent(sessionStorage, destination.searchParams.get("authIntent"));
  expect(intent).toMatchObject({ sourcePath: "/my", sourceQuery: `?locale=${locale}`, actionType: "OPEN_PASSPORT", targetType: "passport", targetId: "collection" });
  expect(destination.searchParams.get("returnTo")).toBe(`/my?locale=${locale}&authIntent=${intent!.id}`);
});
