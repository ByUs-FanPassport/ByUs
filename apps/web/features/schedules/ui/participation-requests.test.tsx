import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ParticipationRequests } from "./participation-requests";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/my/requests", useSearchParams: () => new URLSearchParams() }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: true, user: { id: "owner" } }) }));
vi.mock("@/features/fanpage/ui/use-fanpage-resource", () => ({ useFanpageResource: () => ({ state: { status: "ready", data: { items: [], nextCursor: null } } }) }));

it("keeps request history inside fan navigation and gives both empty lists a next step", () => {
  render(<ParticipationRequests locale="ko" />);
  fireEvent.change(screen.getByRole("combobox", { name: "언어 선택, 현재 한국어" }), { target: { value: "en" } });
  expect(push).toHaveBeenCalledWith("/my/requests?locale=en");
  const main = screen.getByRole("main");
  expect(within(main).getByRole("heading", { level: 1, name: "내 신청 내역" })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "모바일 주요 메뉴" })).toBeInTheDocument();
  expect(within(main).getByRole("link", { name: "MY로 돌아가기" })).toHaveAttribute("href", "/my?locale=ko");
  expect(within(main).getByRole("link", { name: /^일정$/ })).toHaveAttribute("href", "/live/calendar?locale=ko");
  fireEvent.click(within(main).getByRole("button", { name: "팬페이지 개설 신청" }));
  expect(within(main).getByRole("link", { name: "팬페이지 개설 신청" })).toHaveAttribute("href", "/bias/requests?locale=ko");
});
