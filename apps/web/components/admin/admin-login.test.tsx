import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminLogin } from "./admin-login";

const login = vi.fn();

vi.mock("@privy-io/react-auth", () => ({
  useLogin: () => ({ login }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("./use-admin-session", () => ({ useAdminSession: () => ({ status: "unauthenticated" }) }));

describe("AdminLogin", () => {
  beforeEach(() => login.mockClear());

  it("uses the real Google-only Privy login and does not claim access", () => {
    render(<AdminLogin />);
    fireEvent.click(screen.getByRole("button", { name: "Google로 관리자 로그인" }));

    expect(login).toHaveBeenCalledWith({ loginMethods: ["google"] });
    expect(screen.getByText("로그인 후 서버에서 관리자 권한을 확인합니다.")).toBeInTheDocument();
    expect(screen.queryByText("관리자 로그인 완료")).not.toBeInTheDocument();
  });

  it("renders an explicit denial without exposing admin navigation", () => {
    render(<AdminLogin access="denied" />);

    expect(screen.getByRole("alert")).toHaveTextContent("등록된 관리자 계정이 아닙니다");
    expect(screen.queryByRole("navigation", { name: "관리자 메뉴" })).not.toBeInTheDocument();
  });
});
