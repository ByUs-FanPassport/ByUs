import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FanpageRequestForm } from "./fanpage-request-form";

vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: true, user: { id: "owner" }, getAccessToken: vi.fn(async () => "token"), login: vi.fn() }) }));
vi.mock("@/components/byus-session-provider", () => ({ useByUsSession: () => ({ ready: true, generation: 0 }) }));

it("explains and focuses an unsupported official profile URL without clearing it", async () => {
  render(<FanpageRequestForm locale="ko" initialName="KARA" />);
  const social = screen.getByRole("textbox", { name: "공식 계정 URL" });
  fireEvent.change(social, { target: { value: "https://instagram.com/p/post" } });
  fireEvent.click(screen.getByRole("button", { name: "중복 확인" }));
  await waitFor(() => expect(social).toHaveFocus());
  expect(social).toHaveAttribute("aria-invalid", "true");
  expect(social).toHaveValue("https://instagram.com/p/post");
  expect(screen.getByText("지원 서비스의 공식 프로필 주소를 입력해 주세요.")).toBeInTheDocument();
});
