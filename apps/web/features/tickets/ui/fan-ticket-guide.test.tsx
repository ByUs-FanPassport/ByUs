import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticated: true, state: { status: "loading" } as unknown, retry: vi.fn() }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: mocks.authenticated, user: { id: "owner" }, getAccessToken: vi.fn() }) }));
vi.mock("@/components/fan-ui/use-owned-fan-resource", () => ({ useOwnedFanResource: () => ({ state: mocks.state, retry: mocks.retry, refreshFailed: false }) }));
vi.mock("@/components/auth-intent-link", () => ({ AuthIntentLink: ({ children }: { children: React.ReactNode }) => <a href="/login">{children}</a> }));
import { FanTicketGuide } from "./fan-ticket-guide";

const ready = {
  status: "ready", data: {
    enabled: true, creator: { slug: "elina", name: "엘리나" }, balance: 4, today: "2026-09-15", nextBefore: null, history: [],
    actions: [
      { key: "verification", amount: 1, status: "awarded", href: "/c/elina/verify" },
      { key: "membership_instagram", amount: 1, status: "pending", href: "/elina?tab=certifications" },
      { key: "checkin", amount: 1, status: "available", href: "/elina#daily-checkin" },
    ],
  },
};

describe("FanTicketGuide", () => {
  beforeEach(() => { mocks.authenticated = true; mocks.state = { status: "loading" }; mocks.retry.mockClear(); });
  it("shows a generic sign-in invitation to guests only for enabled campaign creators", () => {
    mocks.authenticated = false;
    const { rerender } = render(<FanTicketGuide creatorSlug="elina" creatorName="엘리나" locale="ko" />);
    expect(screen.getByRole("heading", { name: "응모권 모으기" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /로그인하고 확인/ })).toBeInTheDocument();
    rerender(<FanTicketGuide creatorSlug="kara" creatorName="KARA" locale="ko" />);
    expect(screen.queryByRole("heading", { name: "응모권 모으기" })).not.toBeInTheDocument();
  });
  it("renders awarded, pending, and available activity states with localized links", () => {
    mocks.state = ready;
    render(<FanTicketGuide creatorSlug="elina" creatorName="Elina" locale="en" />);
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText(/Awarded/)).toBeInTheDocument();
    expect(screen.getByText(/Verification pending/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Today's check-in/ })).toHaveAttribute("href", "/elina?locale=en#daily-checkin");
    expect(screen.getByRole("link", { name: /View ticket history/ })).toHaveAttribute("href", "/c/elina/tickets?locale=en");
  });
  it("keeps malformed or unavailable owner data behind an error state", () => {
    mocks.state = { status: "error", kind: "network" };
    render(<FanTicketGuide creatorSlug="yuna" creatorName="유나" locale="ko" />);
    expect(screen.getByRole("alert")).toHaveTextContent("불러오지 못했어요");
    screen.getByRole("button", { name: "다시 시도" }).click();
    expect(mocks.retry).toHaveBeenCalledTimes(1);
  });
  it("keeps the home summary focused on balance and today's available action", () => {
    mocks.state = ready;
    render(<FanTicketGuide creatorSlug="elina" creatorName="엘리나" locale="ko" compact />);
    expect(screen.getByText("4장")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /오늘 출석하고 1장 받기/ })).toHaveAttribute("href", "/elina?locale=ko#daily-checkin");
    expect(screen.getByRole("link", { name: /응모권 모으기/ })).toHaveAttribute("href", "/c/elina/tickets?locale=ko");
    expect(screen.queryByText("팬 인증")).not.toBeInTheDocument();
    expect(screen.queryByText("Instagram 멤버십")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /래플 보러 가기/ })).not.toBeInTheDocument();
  });
  it.each([
    ["awarded", "오늘 출석 완료"],
    ["processing", "출석 보상 지급 중"],
    ["pending", "출석 확인 중"],
  ])("does not offer another check-in for %s records", (status, label) => {
    mocks.state = { ...ready, data: { ...ready.data, actions: ready.data.actions.map(action => action.key === "checkin" ? { ...action, status } : action) } };
    render(<FanTicketGuide creatorSlug="elina" creatorName="엘리나" locale="ko" compact />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /오늘 출석/ })).not.toBeInTheDocument();
  });
  it("keeps a compact guest invitation without exposing a balance or listing actions", () => {
    mocks.authenticated = false;
    render(<FanTicketGuide creatorSlug="elina" creatorName="엘리나" locale="ko" compact />);
    expect(screen.getByRole("heading", { name: "응모권 모으기" })).toBeInTheDocument();
    expect(screen.queryByText(/팬 활동으로 응모권/)).not.toBeInTheDocument();
    expect(screen.queryByText("보유 응모권")).not.toBeInTheDocument();
  });
});
